// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind, MediaStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { pickMostAdvanced, groupByDepartment, type DepartmentGroup } from '../lib/pipelineOrder';
import { resolveProjectSettingsById, type Department } from '../lib/projectSettings';
import { ASSIGNEE_SELECT, toAssigneeView, type AssigneeView } from './EntityAssigneeService';
import { storage } from './StorageService';

/**
 * "What is the latest version?" — the question asked at each opening of an asset and at each edit computation
 * (Phase 45).
 *
 * The rule is that of `lib/pipelineOrder`: the most advanced step of the pipe that has something visible,
 * then the most recent one at that step. Everything here works in BATCHES
 * (`latestForShots`, `latestForAssets`): an edit of two hundred shots cannot issue two hundred queries, and
 * the sort by pipe is done in memory anyway.
 */

/** A media is visible to the team when it is published, ready, and not in the trash. */
const VISIBLE_MEDIA = { deletedAt: null, published: true, status: MediaStatus.READY } as const;

const mediaSelect = {
  id: true,
  kind: true,
  originalName: true,
  storageKey: true,
  thumbnailKey: true,
  mimeType: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.MediaObjectSelect;

export type LatestMedia = Prisma.MediaObjectGetPayload<{ select: typeof mediaSelect }>;

/** Version retained for an entity, with its task, its step and the media to play. */
export interface LatestPick {
  versionId: number;
  versionName: string;
  createdAt: Date;
  department: string | null;
  taskId: number | null;
  taskName: string | null;
  media: LatestMedia | null;
  /** All the visible media of the version (the player picks one, the tree lists them). */
  allMedia: LatestMedia[];
}

const versionSelect = {
  id: true,
  name: true,
  status: true,
  createdAt: true,
  assetId: true,
  author: { select: { id: true, name: true, username: true } },
  reviewStatus: { select: { id: true, name: true, color: true, isApproval: true, isRetake: true } },
  task: { select: { id: true, name: true, department: true, type: true, shotId: true, assetId: true } },
  media: { where: VISIBLE_MEDIA, select: mediaSelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.VersionSelect;

type VersionRow = Prisma.VersionGetPayload<{ select: typeof versionSelect }>;

/**
 * The media to play for a version. Video takes precedence: an edit chains shots together, and a still image
 * in the middle of a sequence is a shot only for lack of a better option.
 */
function preferPlayable(media: LatestMedia[]): LatestMedia | null {
  return media.find((m) => m.kind === MediaKind.VIDEO) ?? media[0] ?? null;
}

function toPick(row: VersionRow): LatestPick {
  return {
    versionId: row.id,
    versionName: row.name,
    createdAt: row.createdAt,
    department: row.task?.department ?? null,
    taskId: row.task?.id ?? null,
    taskName: row.task?.name ?? null,
    media: preferPlayable(row.media),
    allMedia: row.media,
  };
}

/**
 * The bare minimum needed for the election: attachment, step, date, identifier.
 *
 * The election used to load the WHOLE version — author, review status and all its media, JSON `metadata`
 * included — for all the published versions of the requested entities, then
 * discarded 90 % of it. An edit of two thousand shots with ten versions each thus fetched tens of thousands
 * of rows to keep two thousand.
 */
const candidateSelect = {
  id: true,
  createdAt: true,
  assetId: true,
  task: { select: { department: true, shotId: true, assetId: true } },
} satisfies Prisma.VersionSelect;

type CandidateRow = Prisma.VersionGetPayload<{ select: typeof candidateSelect }>;

/** Contenders: published versions carrying at least one visible media, minimal columns. */
function fetchCandidates(where: Prisma.VersionWhereInput): Promise<CandidateRow[]> {
  return prisma.version.findMany({
    where: { ...where, deletedAt: null, published: true, media: { some: VISIBLE_MEDIA } },
    select: candidateSelect,
    orderBy: { createdAt: 'asc' },
  });
}

/** Elects the most advanced version of each parent entity, without loading their content. */
function electPerParent(
  rows: CandidateRow[],
  parentOf: (row: CandidateRow) => number | null,
  departments: Department[],
): Map<number, number> {
  const byParent = new Map<number, CandidateRow[]>();
  for (const row of rows) {
    const parent = parentOf(row);
    if (parent === null) continue;
    const list = byParent.get(parent);
    if (list) list.push(row);
    else byParent.set(parent, [row]);
  }
  const out = new Map<number, number>();
  for (const [parent, list] of byParent) {
    const winner = pickMostAdvanced(
      list.map((row) => ({ id: row.id, at: row.createdAt, department: row.task?.department ?? null })),
      departments,
    );
    if (winner) out.set(parent, winner.id);
  }
  return out;
}

/**
 * Loads the content of the elected versions only — at most one per entity — then files it under its parent.
 */
async function loadPicks(elected: Map<number, number>): Promise<Map<number, LatestPick>> {
  const out = new Map<number, LatestPick>();
  if (elected.size === 0) return out;
  const rows = await prisma.version.findMany({
    where: { id: { in: [...new Set(elected.values())] } },
    select: versionSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [parent, versionId] of elected) {
    const row = byId.get(versionId);
    if (row) out.set(parent, toPick(row));
  }
  return out;
}

/**
 * Latest version of each shot. `department` restricts the search to a specific step (edit "Layout", edit
 * "Anim"…); the fallback on upstream steps remains ensured, since only the top of the ranking is then
 * filtered.
 */
export async function latestForShots(
  shotIds: number[],
  departments: Department[],
  department?: string | null,
): Promise<Map<number, LatestPick>> {
  if (shotIds.length === 0) return new Map();
  const rows = await fetchCandidates({ task: { shotId: { in: shotIds } } });
  const kept = department ? withinDepartment(rows, departments, department) : rows;
  return loadPicks(electPerParent(kept, (row) => row.task?.shotId ?? null, departments));
}

/**
 * Restricts to the steps located AT MOST at the requested level: asking for "Layout" on a shot already in
 * compositing must show the layout, not the compositing; asking for "Lighting"
 * on a shot that does not yet have any must show the animation rather than an empty card.
 */
function withinDepartment(
  rows: CandidateRow[],
  departments: Department[],
  department: string,
): CandidateRow[] {
  const ceiling = departments.findIndex((d) => d.key.toLowerCase() === department.toLowerCase());
  if (ceiling < 0) return rows;
  return rows.filter((row) => {
    const rank = departments.findIndex(
      (d) => d.key.toLowerCase() === (row.task?.department ?? '').toLowerCase(),
    );
    return rank >= 0 && rank <= ceiling;
  });
}

/** Latest version of each asset — versions of its tasks AND direct versions. */
export async function latestForAssets(
  assetIds: number[],
  departments: Department[],
): Promise<Map<number, LatestPick>> {
  if (assetIds.length === 0) return new Map();
  const rows = await fetchCandidates({
    OR: [{ task: { assetId: { in: assetIds } } }, { assetId: { in: assetIds } }],
  });
  return loadPicks(electPerParent(rows, (row) => row.task?.assetId ?? row.assetId, departments));
}

/** A task in an asset's tree, with its versions from most recent to oldest. */
export interface AssetTreeTask {
  id: number | null;
  name: string;
  type: string | null;
  status: string | null;
  /** Customisable status (48): that of the ShotGrid site on a linked project. */
  pipelineStatusId: number | null;
  /** Scheduling (48): ShotGrid's pick-up when the project is linked to it. */
  startDate: Date | null;
  dueDate: Date | null;
  department: string | null;
  /**
   * Who is responsible for it.
   *
   * The tree did not say so: a task's card showed its status and its versions, but not the person — one had
   * to open the task to find out, and reopen each one to know who was missing on the shot.
   */
  assignee: AssigneeView | null;
  versions: AssetTreeVersion[];
}

export interface AssetTreeVersion {
  id: number;
  name: string;
  status: string;
  published: boolean;
  createdAt: Date;
  author: { id: number; name: string | null; username: string | null } | null;
  reviewStatus: { id: number; name: string; color: string } | null;
  media: LatestMedia[];
}

/**
 * The asset seen as a folder: departments in pipe order → tasks → versions.
 *
 * Drafts are included (the artist must find their work in progress), but their media remain filtered by the
 * usual visibility: `userId` sees their own, the team sees what is published.
 * The versions attached directly to the asset — without a task — form a pseudo-task: they exist in the
 * database and nobody must lose them.
 */
export async function assetTree(
  assetId: number,
  departments: Department[],
  userId: number,
): Promise<DepartmentGroup<AssetTreeTask>[]> {
  return entityTree({ assetId }, departments, userId);
}

/**
 * The same tree for a shot.
 *
 * A shot goes through its steps exactly as an asset does — anim, lighting, compositing — and its work reads
 * the same way: a card per task, its versions underneath. There is no reason
 * for the two screens to diverge, nor for the same query to be written twice. Only the column carrying the
 * attachment changes.
 */
export async function shotTree(
  shotId: number,
  departments: Department[],
  userId: number,
): Promise<DepartmentGroup<AssetTreeTask>[]> {
  return entityTree({ shotId }, departments, userId);
}

async function entityTree(
  parent: { assetId: number } | { shotId: number },
  departments: Department[],
  userId: number,
): Promise<DepartmentGroup<AssetTreeTask>[]> {
  const visible = { deletedAt: null, OR: [{ published: true }, { uploaderId: userId }] };
  const [tasks, looseVersions] = await Promise.all([
    prisma.task.findMany({
      where: parent,
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        pipelineStatusId: true,
        startDate: true,
        dueDate: true,
        department: true,
        assignee: { select: ASSIGNEE_SELECT },
        versions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { ...versionSelect, published: true, media: { where: visible, select: mediaSelect } },
        },
      },
    }),
    // Versions attached directly to the parent, without a task. A shot never carries any (the database does
    // not allow it), but an asset does: they exist, nobody must lose them.
    'assetId' in parent
      ? prisma.version.findMany({
          where: { assetId: parent.assetId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { ...versionSelect, published: true, media: { where: visible, select: mediaSelect } },
        })
      : Promise.resolve([]),
  ]);

  const toVersion = (v: (typeof looseVersions)[number]): AssetTreeVersion => ({
    id: v.id,
    name: v.name,
    status: v.status,
    published: v.published,
    createdAt: v.createdAt,
    author: v.author,
    reviewStatus: v.reviewStatus
      ? { id: v.reviewStatus.id, name: v.reviewStatus.name, color: v.reviewStatus.color }
      : null,
    media: v.media,
  });

  const entries: AssetTreeTask[] = await Promise.all(
    tasks.map(async (t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      pipelineStatusId: t.pipelineStatusId,
      startDate: t.startDate,
      dueDate: t.dueDate,
      department: t.department,
      assignee: t.assignee ? await toAssigneeView(t.assignee) : null,
      versions: t.versions.map(toVersion),
    })),
  );
  if (looseVersions.length > 0) {
    entries.push({
      id: null,
      name: '',
      type: null,
      pipelineStatusId: null,
      startDate: null,
      dueDate: null,
      status: null,
      department: null,
      assignee: null,
      versions: looseVersions.map(toVersion),
    });
  }
  return groupByDepartment(entries, departments);
}

/** Media as it leaves the API: the storage key stays on the server, the URL is signed. */
export interface MediaView {
  id: number;
  kind: MediaKind;
  originalName: string;
  mimeType: string;
  createdAt: Date;
  thumbnailUrl: string | null;
}

const toMediaView = async (m: LatestMedia): Promise<MediaView> => ({
  id: m.id,
  kind: m.kind,
  originalName: m.originalName,
  mimeType: m.mimeType,
  createdAt: m.createdAt,
  thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
});

/** A version as it leaves the API (signed media). */
export type AssetTreeVersionView = Omit<AssetTreeVersion, 'media'> & { media: MediaView[] };
export type AssetTreeTaskView = Omit<AssetTreeTask, 'versions'> & { versions: AssetTreeVersionView[] };

export interface AssetOverview {
  /** The project's pipe, in order — the interface uses it for its headers. */
  departments: Department[];
  groups: DepartmentGroup<AssetTreeTaskView>[];
  latest: {
    versionId: number;
    versionName: string;
    department: string | null;
    departmentName: string | null;
    taskId: number | null;
    taskName: string | null;
    createdAt: Date;
    media: MediaView | null;
  } | null;
}

/**
 * The asset as the screen shows it: its pipe, its tree departments → tasks → versions, and the version that
 * counts. Everything is assembled here so that the route remains a route —
 * and so that a single place decides what "the latest version" is.
 */
export async function assetOverview(assetId: number, userId: number): Promise<AssetOverview> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
    select: { projectId: true },
  });
  if (!asset) throw notFound('Asset not found');
  const { departments } = await resolveProjectSettingsById(asset.projectId);

  const [groups, latestMap] = await Promise.all([
    assetTree(assetId, departments, userId),
    latestForAssets([assetId], departments),
  ]);

  const signedGroups = await Promise.all(
    groups.map(async (g) => ({
      ...g,
      items: await Promise.all(
        g.items.map(async (task) => ({
          ...task,
          versions: await Promise.all(
            task.versions.map(async (v) => ({
              ...v,
              media: await Promise.all(v.media.map(toMediaView)),
            })),
          ),
        })),
      ),
    })),
  );

  const pick = latestMap.get(assetId) ?? null;
  const nameOf = (key: string | null) =>
    key ? (departments.find((d) => d.key.toLowerCase() === key.toLowerCase())?.name ?? key) : null;

  return {
    departments,
    groups: signedGroups,
    latest: pick
      ? {
          versionId: pick.versionId,
          versionName: pick.versionName,
          department: pick.department,
          departmentName: nameOf(pick.department),
          taskId: pick.taskId,
          taskName: pick.taskName,
          createdAt: pick.createdAt,
          media: pick.media ? await toMediaView(pick.media) : null,
        }
      : null,
  };
}

/**
 * The shot seen as a folder — exact counterpart of `assetOverview`.
 *
 * A shot and an asset are worked on in the same way: steps, tasks, versions. Giving them two different
 * screens would force the team to learn the same thing twice, and to keep
 * the mechanics up to date twice.
 */
export async function shotOverview(shotId: number, userId: number): Promise<AssetOverview> {
  const shot = await prisma.shot.findFirst({
    where: { id: shotId, deletedAt: null },
    select: { projectId: true },
  });
  if (!shot) throw notFound('Shot not found');
  const { departments } = await resolveProjectSettingsById(shot.projectId);

  const [groups, latestMap] = await Promise.all([
    shotTree(shotId, departments, userId),
    latestForShots([shotId], departments),
  ]);
  const signedGroups = await Promise.all(
    groups.map(async (g) => ({
      ...g,
      items: await Promise.all(
        g.items.map(async (task) => ({
          ...task,
          versions: await Promise.all(
            task.versions.map(async (v) => ({
              ...v,
              media: await Promise.all(v.media.map(toMediaView)),
            })),
          ),
        })),
      ),
    })),
  );

  const pick = latestMap.get(shotId) ?? null;
  const nameOf = (key: string | null) =>
    key ? (departments.find((d) => d.key.toLowerCase() === key.toLowerCase())?.name ?? key) : null;

  return {
    departments,
    groups: signedGroups,
    latest: pick
      ? {
          versionId: pick.versionId,
          versionName: pick.versionName,
          department: pick.department,
          departmentName: nameOf(pick.department),
          taskId: pick.taskId,
          taskName: pick.taskName,
          createdAt: pick.createdAt,
          media: pick.media ? await toMediaView(pick.media) : null,
        }
      : null,
  };
}
