// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, type Prisma } from '@prisma/client';
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
 * Montage automatique d'une séquence ou d'un projet (Phase 45).
 *
 * Le contenu n'est JAMAIS stocké : il est recalculé à chaque lecture depuis l'état réel
 * de la production. C'est tout l'intérêt — une liste figée serait périmée à la
 * publication suivante, et il faudrait la rafraîchir à la main, ce qui est exactement le
 * travail que ce montage supprime.
 *
 * Ce qui se persiste, c'est ce qu'un humain a décidé : le nom, le département visé, et
 * les révisions figées (`snapshot`) — les seules choses qu'un recalcul ne peut pas
 * retrouver.
 */

type SessionUser = { id: number; role: Role };

const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Renommer, cibler une étape ou figer une révision engage la production : superviseur+. */
function assertCanManage(user: SessionUser): void {
  if (!isManager(user.role)) throw forbidden('Réservé aux superviseurs/admins');
}

/**
 * Le montage d'une séquence (ou du projet entier si `sequenceId` est null), créé au
 * premier accès. Personne n'a à « créer un montage » : il existe dès qu'il y a des plans.
 */
export async function ensure(projectId: number, sequenceId: number | null) {
  const existing = await prisma.timeline.findFirst({ where: { projectId, sequenceId } });
  if (existing) return existing;

  if (sequenceId !== null) {
    const sequence = await prisma.sequence.findFirst({
      where: { id: sequenceId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!sequence) throw badRequest('Séquence invalide pour ce projet', 'BAD_SEQUENCE');
  }
  try {
    return await prisma.timeline.create({ data: { projectId, sequenceId } });
  } catch {
    // Deux onglets ouverts en même temps : le perdant récupère le montage du gagnant.
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
 * Les plans du montage, dans l'ordre de la production : séquence par séquence, puis
 * l'ordre du plan, le code servant d'ultime départage — un plan sans ordre explicite ne
 * doit pas se retrouver placé au hasard.
 */
async function orderedShots(projectId: number, sequenceId: number | null): Promise<ShotRow[]> {
  const shots = await prisma.shot.findMany({
    where: {
      projectId,
      deletedAt: null,
      omitted: false,
      ...(sequenceId !== null ? { sequenceId } : {}),
    },
    select: shotSelect,
  });
  const rank = (s: (typeof shots)[number]) => s.sequence?.order ?? Number.MAX_SAFE_INTEGER;
  shots.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.sequence?.code ?? '').localeCompare(b.sequence?.code ?? '') ||
      a.order - b.order ||
      a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
  return shots.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    sequenceId: s.sequenceId,
    sequenceCode: s.sequence?.code ?? null,
    startFrame: s.startFrame,
    endFrame: s.endFrame,
  }));
}

/** Traduit les versions élues en entrées de montage (durée lue dans les métadonnées). */
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
  thumbnailUrl: string | null;
  placeholder: boolean;
  durationMismatch: boolean;
}

export interface TimelineView {
  id: number;
  projectId: number;
  sequenceId: number | null;
  sequenceCode: string | null;
  /** Null = jamais renommé : l'interface affiche son libellé traduit. */
  name: string | null;
  department: string | null;
  departments: Department[];
  framerate: number;
  items: TimelineClip[];
  totalDuration: number;
  gapCount: number;
  updatedAt: Date;
  latestRevision: number | null;
}

/** Calcule le montage courant : ordre des plans × version la plus avancée × durées. */
export async function resolve(timelineId: number): Promise<TimelineView> {
  const timeline = await prisma.timeline.findUnique({
    where: { id: timelineId },
    include: { sequence: { select: { code: true, settings: true } } },
  });
  if (!timeline) throw notFound('Montage introuvable');

  const settings = await resolveProjectSettingsById(timeline.projectId);
  const fps = sequenceFramerate(timeline.sequence?.settings, settings.framerate);
  const shots = await orderedShots(timeline.projectId, timeline.sequenceId);
  const picks = await latestForShots(
    shots.map((s) => s.id),
    settings.departments,
    timeline.department,
  );
  const items = buildItems(shots, toPickRows(picks), fps);

  const thumbs = new Map<number, string | null>();
  const names = new Map<number, string>();
  for (const pick of picks.values()) {
    if (!pick.media) continue;
    names.set(pick.media.id, pick.media.originalName);
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
      thumbnailUrl: it.mediaId !== null ? (thumbs.get(it.mediaId) ?? null) : null,
    })),
    totalDuration: totalDuration(items),
    gapCount: items.filter((it) => it.placeholder).length,
    updatedAt: timeline.updatedAt,
    latestRevision: latest?.revision ?? null,
  };
}

/** Un segment tel que l'export l'attend : la source à encoder, ou un carton à fabriquer. */
export interface ExportSegment {
  shotCode: string;
  duration: number;
  /** Clé de stockage à encoder — null pour un carton. */
  storageKey: string | null;
}

export interface ExportPlan {
  timelineId: number;
  projectId: number;
  profile: { width: number; height: number; fps: number };
  segments: ExportSegment[];
}

/**
 * Le montage tel que le worker doit l'encoder : clés de stockage plutôt qu'URLs signées,
 * et le proxy MP4 de préférence à la source. Le proxy est déjà normalisé pour le web —
 * réencoder un EXR ou un ProRes de 4 Go pour en tirer trente secondes de montage serait
 * du gâchis, et parfois un échec sur des formats que le concat ne digère pas.
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

/** Cadence effective : l'override de la séquence prime sur celle du projet (Phase 18). */
function sequenceFramerate(raw: unknown, fallback: number): number {
  const o = (raw ?? {}) as { framerate?: unknown };
  return typeof o.framerate === 'number' && o.framerate > 0 ? o.framerate : fallback;
}

export interface UpdateTimelineInput {
  name?: string | null;
  department?: string | null;
}

/** Renomme le montage ou change l'étape visée (superviseur+). */
export async function update(user: SessionUser, timelineId: number, body: UpdateTimelineInput) {
  assertCanManage(user);
  const timeline = await prisma.timeline.findUnique({ where: { id: timelineId } });
  if (!timeline) throw notFound('Montage introuvable');
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
 * Fige la révision courante. Les libellés sont recopiés dans les lignes : une révision
 * doit rester lisible quand un plan est renommé, omis ou mis à la corbeille — c'est un
 * compte rendu de ce qui a été montré, pas une vue sur l'état actuel.
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
  /** Un master est disponible au téléchargement. */
  ready: boolean;
  url: string | null;
  size: number | null;
  /** État du job en cours, s'il y en a un (`waiting`, `active`, `failed`…). */
  state: string | null;
}

/**
 * État de l'export d'un montage. Le master vit à une clé déterministe : son existence
 * suffit à savoir qu'il y a quelque chose à télécharger, sans table de suivi. Le job en
 * cours n'est consulté que pour dire « ça travaille » plutôt que « rien ».
 */
export async function exportState(timelineId: number): Promise<ExportState> {
  const key = masterKey(timelineId);
  const job = await timelineExportQueue.getJob(timelineExportJobId(timelineId));
  const state = job ? await job.getState() : null;
  try {
    const stat = await storage.statObject(key);
    return { ready: true, url: await storage.getPresignedGetUrl(key), size: stat.size, state };
  } catch {
    // Objet absent : aucun export n'a encore abouti pour ce montage.
    return { ready: false, url: null, size: null, state };
  }
}

/** Lance (ou relance) l'export du montage — superviseur+, un job à la fois. */
export async function requestExport(user: SessionUser, timelineId: number): Promise<ExportState> {
  assertCanManage(user);
  const previous = await timelineExportQueue.getJob(timelineExportJobId(timelineId));
  // Un job terminé ou échoué garde son identifiant : sans purge, le relancer serait ignoré.
  if (previous && ['completed', 'failed'].includes(await previous.getState())) await previous.remove();
  await enqueueTimelineExport({ timelineId, requestedById: user.id });
  return exportState(timelineId);
}

/** Révisions figées d'un montage, de la plus récente à la plus ancienne. */
export function listSnapshots(timelineId: number) {
  return prisma.timelineSnapshot.findMany({
    where: { timelineId },
    orderBy: { revision: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
      _count: { select: { items: true } },
    },
  });
}

/**
 * Une révision et ce qui la sépare de la précédente. La comparaison est le vrai usage :
 * « qu'est-ce qui a bougé depuis la projection de mardi ? ».
 */
export async function getSnapshot(timelineId: number, revision: number) {
  const snap = await prisma.timelineSnapshot.findFirst({
    where: { timelineId, revision },
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
      items: { orderBy: { order: 'asc' } },
    },
  });
  if (!snap) throw notFound('Révision introuvable');
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
