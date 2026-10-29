// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, Role, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { resolveProjectSettingsById, type Department } from '../lib/projectSettings';
import { buildItems, diffItems, totalDuration, type PickRow, type ShotRow } from '../lib/timelineBuild';
import { masterKey } from '../lib/timelineExport';
import { latestForShots, type LatestPick } from './PipelineLatestService';
import { storage } from './StorageService';
import { emitToProject } from './SocketService';
import { enqueueTimelineExport, timelineExportJobId, timelineExportQueue } from './JobService';

/**
 * Automatic timeline (montage) of a sequence or a project (Phase 45).
 *
 * The content is NEVER stored: it is recomputed on every read from the real state of the production. That is the whole point — a frozen list would be stale at the
 * next publication, and would have to be refreshed by hand, which is exactly the work this timeline removes.
 *
 * What is persisted is what a human has decided: the name, the targeted department, and the frozen revisions (`snapshot`) — the only things a recomputation
 * cannot recover.
 */

type SessionUser = { id: number; role: Role };

const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Renaming, targeting a step or freezing a revision commits the production: supervisor+. */
function assertCanManage(user: SessionUser): void {
  if (!isManager(user.role)) throw forbidden('Supervisors and administrators only');
}

/**
 * The timeline of a sequence (or of the whole project if `sequenceId` is null), created on first access. Nobody has to "create a timeline": it exists as soon as there are shots.
 */
export async function ensure(projectId: number, sequenceId: number | null) {
  const existing = await prisma.timeline.findFirst({ where: { projectId, sequenceId } });
  if (existing) return existing;

  if (sequenceId !== null) {
    const sequence = await prisma.sequence.findFirst({
      where: { id: sequenceId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!sequence) throw badRequest('This sequence does not belong to this project', 'BAD_SEQUENCE');
  }
  try {
    return await prisma.timeline.create({ data: { projectId, sequenceId } });
  } catch {
        // Two tabs open at the same time: the loser picks up the winner's timeline.
    const winner = await prisma.timeline.findFirst({ where: { projectId, sequenceId } });
    if (!winner) throw badRequest('Montage indisponible', 'TIMELINE_UNAVAILABLE');
    return winner;
  }
}

const shotSelect = {
  id: true,
  code: true,
  name: true,
  startFrame: true,
  endFrame: true,
  order: true,
  sequenceId: true,
  sequence: { select: { id: true, code: true, order: true } },
} satisfies Prisma.ShotSelect;

/**
 * Cap of the timeline. A feature film fits under two thousand shots; beyond that, we are in import anomaly territory, and loading the whole table to sort it in memory
 * would bring the server down rather than display anything useful.
 */
const TIMELINE_SHOT_LIMIT = 5000;

/** Revisions listed in a timeline's selector (most recent first). */
const SNAPSHOT_LIST_LIMIT = 200;

/**
 * The shots of the timeline, in production order: sequence by sequence, then shot order, the code serving as the final tie-break — a shot without an explicit order
 * must not end up placed at random.
 *
 * The query is bounded AND sorted on the database side: without `orderBy`, the cap would have cut into an arbitrary set, and the timeline of one project would have changed
 * from one refresh to the next. The sort ends in memory because the code tie-break is **natural** (`SH2` before `SH10`), which no SQL collation does — the displayed order is therefore
 * exactly the same as before, over a set that is now deterministic.
 */
async function orderedShots(
  projectId: number,
  sequenceId: number | null,
): Promise<{ rows: ShotRow[]; truncated: boolean }> {
  const shots = await prisma.shot.findMany({
    where: {
      projectId,
      deletedAt: null,
      omitted: false,
            // A hidden shot does not go into the cut. Distinct from `omitted`, which is a visible editorial decision shared by all: hiding, for its part, removes the item everywhere.
      hiddenAt: null,
            // A hidden sequence takes its shots with it: without this condition, the timeline of the whole film would replay the shots of a sequence that appears nowhere any more.
            // The `sequenceId: null` branch is indispensable — a relation filter alone would discard the shots that have no sequence at all, yet which belong in the timeline.
      OR: [{ sequenceId: null }, { sequence: { hiddenAt: null } }],
      ...(sequenceId !== null ? { sequenceId } : {}),
    },
        // Shots outside any sequence go to the end of the list: Postgres puts NULLs last on an ascending sort, as the `MAX_SAFE_INTEGER` rank did.
    orderBy: [
      { sequence: { order: 'asc' } },
      { sequence: { code: 'asc' } },
      { order: 'asc' },
      { code: 'asc' },
      { id: 'asc' },
    ],
    take: TIMELINE_SHOT_LIMIT,
    select: shotSelect,
  });
  const rank = (s: (typeof shots)[number]) => s.sequence?.order ?? Number.MAX_SAFE_INTEGER;
  shots.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.sequence?.code ?? '').localeCompare(b.sequence?.code ?? '') ||
      a.order - b.order ||
      a.code.localeCompare(b.code, undefined, { numeric: true }) ||
      a.id - b.id,
  );
  return {
    rows: shots.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      sequenceId: s.sequenceId,
      sequenceCode: s.sequence?.code ?? null,
      startFrame: s.startFrame,
      endFrame: s.endFrame,
    })),
    truncated: shots.length >= TIMELINE_SHOT_LIMIT,
  };
}

/** Translates the elected versions into timeline entries (duration read from the metadata). */
function toPickRows(picks: Map<number, LatestPick>): Map<number, PickRow> {
  const out = new Map<number, PickRow>();
  for (const [shotId, pick] of picks) {
    const meta = (pick.media?.metadata ?? {}) as { duration?: unknown };
    out.set(shotId, {
      versionId: pick.versionId,
      versionName: pick.versionName,
      department: pick.department,
      mediaId: pick.media?.id ?? null,
      mediaDuration: typeof meta.duration === 'number' && meta.duration > 0 ? meta.duration : null,
    });
  }
  return out;
}

export interface TimelineClip {
  order: number;
  startTime: number;
  duration: number;
  shotId: number;
  shotCode: string;
  shotName: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  versionId: number | null;
  versionName: string | null;
  department: string | null;
  departmentName: string | null;
  mediaId: number | null;
  mediaName: string | null;
    /**
     * Nature of the retained media. The timeline favours video (`preferPlayable`), but a shot whose only published version is an image does land here — and the player must
     * know it: served to a `<video>` tag, a JPEG does not demultiplex and playback stays stuck on the shot without any message.
     */
  mediaKind: MediaKind | null;
  thumbnailUrl: string | null;
  placeholder: boolean;
  durationMismatch: boolean;
}

export interface TimelineView {
  id: number;
  projectId: number;
  sequenceId: number | null;
  sequenceCode: string | null;
    /** Null = never renamed: the interface displays its translated label. */
  name: string | null;
  department: string | null;
  departments: Department[];
  framerate: number;
  items: TimelineClip[];
  totalDuration: number;
  gapCount: number;
  updatedAt: Date;
  latestRevision: number | null;
    /** The shot cap has bitten: the timeline shown is not the whole timeline. */
  truncated: boolean;
}

/** Computes the current timeline: shot order × most advanced version × durations. */
export async function resolve(timelineId: number): Promise<TimelineView> {
  const timeline = await prisma.timeline.findUnique({
    where: { id: timelineId },
    include: { sequence: { select: { code: true, settings: true } } },
  });
  if (!timeline) throw notFound('Timeline not found');

  const settings = await resolveProjectSettingsById(timeline.projectId);
  const fps = sequenceFramerate(timeline.sequence?.settings, settings.framerate);
  const { rows: shots, truncated } = await orderedShots(timeline.projectId, timeline.sequenceId);
  const picks = await latestForShots(
    shots.map((s) => s.id),
    settings.departments,
    timeline.department,
  );
  const items = buildItems(shots, toPickRows(picks), fps);

  const thumbs = new Map<number, string | null>();
  const names = new Map<number, string>();
  const kinds = new Map<number, MediaKind>();
  for (const pick of picks.values()) {
    if (!pick.media) continue;
    names.set(pick.media.id, pick.media.originalName);
    kinds.set(pick.media.id, pick.media.kind);
    thumbs.set(
      pick.media.id,
      pick.media.thumbnailKey ? await storage.getPresignedGetUrl(pick.media.thumbnailKey) : null,
    );
  }
  const nameOf = (key: string | null) =>
    key ? (settings.departments.find((d) => d.key.toLowerCase() === key.toLowerCase())?.name ?? key) : null;

  const latest = await prisma.timelineSnapshot.findFirst({
    where: { timelineId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });

  return {
    id: timeline.id,
    projectId: timeline.projectId,
    sequenceId: timeline.sequenceId,
    sequenceCode: timeline.sequence?.code ?? null,
    name: timeline.name,
    department: timeline.department,
    departments: settings.departments,
    framerate: fps,
    items: items.map((it) => ({
      ...it,
      departmentName: nameOf(it.department),
      mediaName: it.mediaId !== null ? (names.get(it.mediaId) ?? null) : null,
      mediaKind: it.mediaId !== null ? (kinds.get(it.mediaId) ?? null) : null,
      thumbnailUrl: it.mediaId !== null ? (thumbs.get(it.mediaId) ?? null) : null,
    })),
    totalDuration: totalDuration(items),
    gapCount: items.filter((it) => it.placeholder).length,
    updatedAt: timeline.updatedAt,
    latestRevision: latest?.revision ?? null,
    truncated,
  };
}

/** A segment as the export expects it: the source to encode, or a title card to build. */
export interface ExportSegment {
  shotCode: string;
  duration: number;
    /** Storage key to encode — null for a title card. */
  storageKey: string | null;
}

export interface ExportPlan {
  timelineId: number;
  projectId: number;
  profile: { width: number; height: number; fps: number };
  segments: ExportSegment[];
}

/**
 * The timeline as the worker must encode it: storage keys rather than signed URLs, and the MP4 proxy in preference to the source. The proxy is already normalized for the web —
 * re-encoding a 4 GB EXR or ProRes to extract thirty seconds of timeline would be wasteful, and sometimes a failure on formats the concat cannot digest.
 */
export async function exportPlan(timelineId: number): Promise<ExportPlan> {
  const view = await resolve(timelineId);
  const settings = await resolveProjectSettingsById(view.projectId);
  const mediaIds = view.items.map((it) => it.mediaId).filter((id): id is number => id !== null);
  const media = await prisma.mediaObject.findMany({
    where: { id: { in: mediaIds } },
    select: { id: true, storageKey: true, metadata: true },
  });
  const keyOf = new Map(
    media.map((m) => {
      const meta = (m.metadata ?? {}) as { proxyKey?: unknown };
      return [m.id, typeof meta.proxyKey === 'string' ? meta.proxyKey : m.storageKey] as const;
    }),
  );
  return {
    timelineId,
    projectId: view.projectId,
    profile: { ...settings.resolution, fps: view.framerate },
    segments: view.items.map((it) => ({
      shotCode: it.shotCode,
      duration: it.duration,
      storageKey: it.mediaId !== null ? (keyOf.get(it.mediaId) ?? null) : null,
    })),
  };
}

/** Effective frame rate: the sequence's override takes precedence over the project's (Phase 18). */
function sequenceFramerate(raw: unknown, fallback: number): number {
  const o = (raw ?? {}) as { framerate?: unknown };
  return typeof o.framerate === 'number' && o.framerate > 0 ? o.framerate : fallback;
}

export interface UpdateTimelineInput {
  name?: string | null;
  department?: string | null;
}

/** Renames the timeline or changes the targeted step (supervisor+). */
export async function update(user: SessionUser, timelineId: number, body: UpdateTimelineInput) {
  assertCanManage(user);
  const timeline = await prisma.timeline.findUnique({ where: { id: timelineId } });
  if (!timeline) throw notFound('Timeline not found');
  const updated = await prisma.timeline.update({
    where: { id: timelineId },
    data: {
      ...(body.name !== undefined ? { name: body.name?.trim() || null } : {}),
      ...(body.department !== undefined ? { department: body.department || null } : {}),
    },
  });
  emitToProject(timeline.projectId, 'timeline:update', {
    projectId: timeline.projectId,
    id: timelineId,
  });
  return updated;
}

/**
 * Freezes the current revision. The labels are copied into the rows: a revision must remain readable when a shot is renamed, omitted or put in the trash — it is an account
 * of what was shown, not a view on the current state.
 */
export async function snapshot(user: SessionUser, timelineId: number, note?: string) {
  assertCanManage(user);
  const view = await resolve(timelineId);
  const last = await prisma.timelineSnapshot.findFirst({
    where: { timelineId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });
  const created = await prisma.timelineSnapshot.create({
    data: {
      timelineId,
      revision: (last?.revision ?? 0) + 1,
      note: note?.trim() || null,
      createdById: user.id,
      items: {
        create: view.items.map((it) => ({
          order: it.order,
          shotId: it.shotId,
          shotCode: it.shotCode,
          sequenceCode: it.sequenceCode,
          versionId: it.versionId,
          versionName: it.versionName,
          mediaId: it.mediaId,
          department: it.department,
          duration: it.duration,
        })),
      },
    },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  emitToProject(view.projectId, 'timeline:update', { projectId: view.projectId, id: timelineId });
  return created;
}

export interface ExportState {
    /** A master is available for download. */
  ready: boolean;
  url: string | null;
  size: number | null;
    /** State of the job in progress, if any (`waiting`, `active`, `failed`...). */
  state: string | null;
}

/**
 * State of a timeline's export. The master lives at a deterministic key: its existence suffices to know there is something to download, without a tracking table. The job in
 * progress is only consulted to say "it's working" rather than "nothing".
 */
export async function exportState(timelineId: number): Promise<ExportState> {
  const key = masterKey(timelineId);
  const job = await timelineExportQueue.getJob(timelineExportJobId(timelineId));
  const state = job ? await job.getState() : null;
  try {
    const stat = await storage.statObject(key);
    return { ready: true, url: await storage.getPresignedGetUrl(key), size: stat.size, state };
  } catch {
        // Object absent: no export has yet succeeded for this timeline.
    return { ready: false, url: null, size: null, state };
  }
}

/** Launches (or relaunches) the timeline's export — supervisor+, one job at a time. */
export async function requestExport(user: SessionUser, timelineId: number): Promise<ExportState> {
  assertCanManage(user);
  const previous = await timelineExportQueue.getJob(timelineExportJobId(timelineId));
    // A completed or failed job keeps its identifier: without a purge, relaunching it would be ignored.
  if (previous && ['completed', 'failed'].includes(await previous.getState())) await previous.remove();
  await enqueueTimelineExport({ timelineId, requestedById: user.id });
  return exportState(timelineId);
}

/**
 * Frozen revisions of a timeline, from most recent to oldest.
 *
 * Bounded: a daily projection over two years makes seven hundred revisions, and the list is a dropdown. Descending order guarantees that it is the oldest that leave the frame,
 * never those being consulted.
 */
export function listSnapshots(timelineId: number) {
  return prisma.timelineSnapshot.findMany({
    where: { timelineId },
    orderBy: { revision: 'desc' },
    take: SNAPSHOT_LIST_LIMIT,
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
      _count: { select: { items: true } },
    },
  });
}

/**
 * A revision and what separates it from the previous one. The comparison is the real use: "what has moved since Tuesday's projection?"
 */
export async function getSnapshot(timelineId: number, revision: number) {
  const snap = await prisma.timelineSnapshot.findFirst({
    where: { timelineId, revision },
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
      items: { orderBy: { order: 'asc' } },
    },
  });
  if (!snap) throw notFound('Revision not found');
  const previous = await prisma.timelineSnapshot.findFirst({
    where: { timelineId, revision: { lt: revision } },
    orderBy: { revision: 'desc' },
    include: { items: { orderBy: { order: 'asc' } } },
  });
  return {
    snapshot: snap,
    diff: previous ? diffItems(previous.items, snap.items) : null,
    previousRevision: previous?.revision ?? null,
  };
}
