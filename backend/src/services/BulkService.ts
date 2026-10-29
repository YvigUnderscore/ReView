// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, TaskStatus, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import * as DepartmentService from './DepartmentService';
import { checkProjectAccess } from '../middleware/rbac';
import { canManageProject, effectiveProjectRole } from '../lib/projectRoles';
import { forbidden, notFound } from '../lib/errors';
import {
  softDeleteProjects,
  softDeleteEpisodes,
  softDeleteSequences,
  softDeleteShots,
  softDeleteAssets,
  softDeleteVersions,
  softDeleteMedias,
  restoreProjects,
  restoreEpisodes,
  restoreSequences,
  restoreShots,
  restoreAssets,
  restoreVersions,
  restoreMedias,
  purgeProjects,
  purgeEpisodes,
  purgeSequences,
  purgeShots,
  purgeAssets,
  purgeVersions,
  purgeMedias,
} from '../lib/trash';
import { logAudit } from './AuditService';
import { assertMediaManage } from './MediaService';
import * as ShotService from './ShotService';
import * as TaskService from './TaskService';
import * as VersionService from './VersionService';

/**
 * Batch actions (13.C). Each id is **re-validated** (project access + business RBAC) before any mutation: if
 * a single id fails, nothing is changed. The trash-enabled domains
 * (episodes/sequences/shots/assets/versions/media) share a validation pass followed by a transactional batch
 * write (`lib/trash`). The patches (tasks/versions) reuse the unit services (real-time emission +
 * notifications).
 *
 * **Re-validation is pooled, not relaxed.** What depends only on the project (is it designatable, does the
 * person belong to it, with which effective role) is resolved ONCE per project for the whole batch; what
 * depends on the entity (author of a version, uploader of a media) is still checked id by id, in the order
 * received. Asking the same question two hundred times used to cost more than a thousand sequential queries
 * before the first write, and protected nothing more.
 */

type SessionUser = { id: number; role: Role };

const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

export const DELETE_DOMAINS = [
  'projects',
  'episodes',
  'sequences',
  'shots',
  'assets',
  'versions',
  'media',
] as const;
export type DeleteDomain = (typeof DELETE_DOMAINS)[number];

/** Domains resolved by a direct read; `media` has its own guard (see below). */
type PipelineDomain = Exclude<DeleteDomain, 'media'>;

/**
 * Version -> project chain, as walked by `resolveProjectIdForVersion` (lib/pipeline), reproduced here to read
 * it in a single query over a whole batch.
 */
const VERSION_PROJECT_SELECT = {
  asset: { select: { projectId: true } },
  task: {
    select: { shot: { select: { projectId: true } }, asset: { select: { projectId: true } } },
  },
} as const;

type VersionProjectChain = {
  asset: { projectId: number } | null;
  task: { shot: { projectId: number } | null; asset: { projectId: number } | null } | null;
};

/** Same precedence as `resolveProjectIdForVersion`: direct asset, then task->shot, then task->asset. */
const projectIdOfVersion = (version: VersionProjectChain): number | null =>
  version.asset?.projectId ?? version.task?.shot?.projectId ?? version.task?.asset?.projectId ?? null;

/** What the access check needs to know about an entity: its project, and its owner. */
interface BulkEntity {
  projectId: number | null;
  /** Author of a version; `null` for domains whose access depends only on the role. */
  ownerId: number | null;
}

/**
 * Resolves the owning project of a whole batch in ONE query.
 *
 * The unit resolvers of `lib/pipeline` make one query per identifier, and three for a version because of its
 * nested relations. Across the two hundred ids the route allows, that meant hundreds of reads all returning
 * the same project. The shape of the `select` is copied as is: same precedence, same null cases. An id absent
 * from the map is an unknown id, exactly as a resolver returning `null` would be.
 */
async function loadBulkEntities(domain: PipelineDomain, ids: number[]): Promise<Map<number, BulkEntity>> {
  const where = { id: { in: ids } };
  switch (domain) {
    case 'projects': {
      const rows = await prisma.project.findMany({ where, select: { id: true } });
      return new Map(rows.map((r) => [r.id, { projectId: r.id, ownerId: null }]));
    }
    case 'episodes': {
      const rows = await prisma.episode.findMany({ where, select: { id: true, projectId: true } });
      return new Map(rows.map((r) => [r.id, { projectId: r.projectId, ownerId: null }]));
    }
    case 'sequences': {
      const rows = await prisma.sequence.findMany({ where, select: { id: true, projectId: true } });
      return new Map(rows.map((r) => [r.id, { projectId: r.projectId, ownerId: null }]));
    }
    case 'shots': {
      const rows = await prisma.shot.findMany({ where, select: { id: true, projectId: true } });
      return new Map(rows.map((r) => [r.id, { projectId: r.projectId, ownerId: null }]));
    }
    case 'assets': {
      const rows = await prisma.asset.findMany({ where, select: { id: true, projectId: true } });
      return new Map(rows.map((r) => [r.id, { projectId: r.projectId, ownerId: null }]));
    }
    case 'versions': {
      const rows = await prisma.version.findMany({
        where,
        select: { id: true, authorId: true, ...VERSION_PROJECT_SELECT },
      });
      return new Map(rows.map((r) => [r.id, { projectId: projectIdOfVersion(r), ownerId: r.authorId }]));
    }
  }
}

/**
 * Project access verdict, memoized for the duration of a batch.
 *
 * The user, their global role and `includeTrashed` do not vary from one identifier to the next: the verdict
 * therefore depends ONLY on the project. Asking for it per entity would redo the same `project.count` and
 * membership read two hundred times before the first write. The promise is memoized, not its value: two
 * concurrent requests share the query. The guard itself remains `checkProjectAccess`: none of its rules is
 * rewritten, we only stop repeating it.
 */
function memoProjectAccess(
  user: SessionUser,
  options: { includeTrashed: boolean },
): (projectId: number) => Promise<boolean> {
  const verdicts = new Map<number, Promise<boolean>>();
  return (projectId) => {
    let verdict = verdicts.get(projectId);
    if (!verdict) {
      verdict = checkProjectAccess(user.id, user.role, projectId, options);
      verdicts.set(projectId, verdict);
    }
    return verdict;
  };
}

const SOFT_DELETE: Record<DeleteDomain, (ids: number[]) => Promise<void>> = {
  projects: softDeleteProjects,
  episodes: softDeleteEpisodes,
  sequences: softDeleteSequences,
  shots: softDeleteShots,
  assets: softDeleteAssets,
  versions: softDeleteVersions,
  media: softDeleteMedias,
};

const RESTORE: Record<DeleteDomain, (ids: number[]) => Promise<void>> = {
  projects: restoreProjects,
  episodes: restoreEpisodes,
  sequences: restoreSequences,
  shots: restoreShots,
  assets: restoreAssets,
  versions: restoreVersions,
  media: restoreMedias,
};

// Permanent purge (DB + MinIO) in batch: one read pass, one delete pass, a single `DeleteObjects` for the
// whole batch (see lib/trash), instead of a looped single purge that chained thousands of MinIO round trips
// inside the HTTP request.
const PURGE: Record<DeleteDomain, (ids: number[]) => Promise<void>> = {
  projects: purgeProjects,
  episodes: purgeEpisodes,
  sequences: purgeSequences,
  shots: purgeShots,
  assets: purgeAssets,
  versions: purgeVersions,
  media: purgeMedias,
};

const AUDIT_ACTION: Record<DeleteDomain, { del: string; restore: string; purge: string; type: string }> = {
  projects: {
    del: 'PROJECT_BULK_DELETE',
    restore: 'PROJECT_BULK_RESTORE',
    purge: 'PROJECT_BULK_PURGE',
    type: 'Project',
  },
  episodes: {
    del: 'EPISODE_BULK_DELETE',
    restore: 'EPISODE_BULK_RESTORE',
    purge: 'EPISODE_BULK_PURGE',
    type: 'Episode',
  },
  sequences: {
    del: 'SEQUENCE_BULK_DELETE',
    restore: 'SEQUENCE_BULK_RESTORE',
    purge: 'SEQUENCE_BULK_PURGE',
    type: 'Sequence',
  },
  shots: { del: 'SHOT_BULK_DELETE', restore: 'SHOT_BULK_RESTORE', purge: 'SHOT_BULK_PURGE', type: 'Shot' },
  assets: {
    del: 'ASSET_BULK_DELETE',
    restore: 'ASSET_BULK_RESTORE',
    purge: 'ASSET_BULK_PURGE',
    type: 'Asset',
  },
  versions: {
    del: 'VERSION_BULK_DELETE',
    restore: 'VERSION_BULK_RESTORE',
    purge: 'VERSION_BULK_PURGE',
    type: 'Version',
  },
  media: {
    del: 'MEDIA_BULK_DELETE',
    restore: 'MEDIA_BULK_RESTORE',
    purge: 'MEDIA_BULK_PURGE',
    type: 'MediaObject',
  },
};

/**
 * Re-validates access to each id of a trash-enabled domain. The pipeline domains
 * (projects/episodes/sequences/shots/ assets) require ADMIN/SUPERVISOR; media delegates to
 * `assertMediaManage` (uploader or manager); versions requires the author or a manager.
 *
 * Measured on the demo database, with a selection inside a single project: the check goes from 3 queries per
 * shot (2 for an ADMIN) to 3 for the whole batch, whatever its number of items.
 *
 * `fromTrash` marks the two operations that, by nature, designate items already in the trash: restore and
 * purge. Only they lift the RBAC invariant ("a project in the trash no longer exists"), otherwise the global
 * trash could neither return nor destroy what it displays. Moving to the trash keeps the full guard.
 */
async function assertDeleteAccess(
  user: SessionUser,
  domain: DeleteDomain,
  ids: number[],
  fromTrash = false,
): Promise<void> {
  if (domain === 'media') return assertMediaBulkManage(user, ids);
  const manager = isManager(user.role);
  const entities = await loadBulkEntities(domain, ids);
  const hasAccess = memoProjectAccess(user, { includeTrashed: fromTrash });
  // The ids are still walked IN THE ORDER RECEIVED: the first one that fails returns the same error as
  // before, with the same id in the message.
  for (const id of ids) {
    const entity = entities.get(id);
    const projectId = entity?.projectId ?? null;
    if (!projectId) throw notFound(`Item ${id} not found`);
    if (!(await hasAccess(projectId))) throw forbidden(`Access denied (${domain} ${id})`);
    if (domain === 'versions') {
      if (!manager && entity?.ownerId !== user.id)
        throw forbidden("Suppression réservée à l'auteur ou un superviseur");
    } else if (!manager) {
      throw forbidden('Supervisors and administrators only');
    }
  }
}

/**
 * Batch media guard.
 *
 * `MediaService.assertMediaManage` remains the ONLY authority on project policy (project designatable,
 * membership, right to contribute, management role): it is called as is on the first media of each project
 * encountered. What we stop doing is repeating it for the next hundred and ninety-nine, whose project verdict
 * is identical by construction: six queries per media, all the same, before any write.
 *
 * Only the rule that truly depends on the media is replayed for the others: project manager, or uploader of
 * that media. If a per-media rule were added to `assertMediaManage`, this is where it would have to be
 * carried over, hence the explicit naming.
 *
 * `fromTrash` does not come into play: `assertMediaManage` checks project access without any trash exemption,
 * and this path merely reuses it. Behaviour unchanged, including for restore and purge.
 */
async function assertMediaBulkManage(user: SessionUser, ids: number[]): Promise<void> {
  // A single identifier: nothing to pool. The prior read would then cost more than it saves (measured: 13
  // queries against 8), and selecting a single media is a common gesture. The original guard is kept as is.
  if (ids.length <= 1) {
    for (const id of ids) await assertMediaManage(id, user);
    return;
  }
  const rows = await prisma.mediaObject.findMany({
    where: { id: { in: ids } },
    select: { id: true, uploaderId: true, version: { select: VERSION_PROJECT_SELECT } },
  });
  const byId = new Map(
    rows.map((row) => [row.id, { uploaderId: row.uploaderId, projectId: projectIdOfVersion(row.version) }]),
  );
  // Projects whose full guard has already passed, with the effective role that was used.
  const cleared = new Map<number, Role | null>();
  for (const id of ids) {
    const media = byId.get(id);
    if (!media) throw notFound('Media not found');
    const projectId = media.projectId;
    if (projectId === null || !cleared.has(projectId)) {
      await assertMediaManage(id, user);
      // Unresolved project: `assertMediaManage` has already thrown, we never get here.
      if (projectId !== null)
        cleared.set(projectId, await effectiveProjectRole(user.id, user.role, projectId));
      continue;
    }
    if (!canManageProject(cleared.get(projectId) ?? null) && media.uploaderId !== user.id)
      throw forbidden("Suppression réservée à l'uploader ou un superviseur");
  }
}

export async function bulkDelete(user: SessionUser, domain: DeleteDomain, ids: number[]): Promise<number> {
  await assertDeleteAccess(user, domain, ids);
  await SOFT_DELETE[domain](ids);
  const a = AUDIT_ACTION[domain];
  logAudit({ userId: user.id, action: a.del, entityType: a.type, entityId: ids[0], metadata: { ids } });
  return ids.length;
}

export async function bulkRestore(user: SessionUser, domain: DeleteDomain, ids: number[]): Promise<number> {
  await assertDeleteAccess(user, domain, ids, true);
  await RESTORE[domain](ids);
  const a = AUDIT_ACTION[domain];
  logAudit({ userId: user.id, action: a.restore, entityType: a.type, entityId: ids[0], metadata: { ids } });
  return ids.length;
}

/**
 * Batch permanent purge (trash -> DB + MinIO deletion). Same access validation pass as delete/restore, then
 * unit purge (each function handles the DB cascade and the storage cleanup after commit). Irreversible.
 */
export async function bulkPurge(user: SessionUser, domain: DeleteDomain, ids: number[]): Promise<number> {
  await assertDeleteAccess(user, domain, ids, true);
  // Purging a project is reserved to ADMIN: this is the rule of the single route (`DELETE
  // /api/projects/:projectId/purge`, requireRole(ADMIN)). `assertDeleteAccess` only asks for a "manager",
  // which includes SUPERVISOR: without this check, the batch path would give a supervisor, whose project
  // access is global, the permanent and irreversible destruction of any project, database and storage
  // included.
  if (domain === 'projects' && user.role !== Role.ADMIN)
    throw forbidden('Permanently purging a project is reserved to administrators');
  await PURGE[domain](ids);
  const a = AUDIT_ACTION[domain];
  logAudit({ userId: user.id, action: a.purge, entityType: a.type, entityId: ids[0], metadata: { ids } });
  return ids.length;
}

// ── Batch patches (status / reassignment / move) ─────────────────────────────────

export interface BulkTaskPatch {
  status?: TaskStatus;
  assigneeId?: number | null;
}

/**
 * Batch task patch: reuses `TaskService.update` (RBAC + notifications + real time) per id. The owning
 * project, however, is resolved for the whole batch in one query: asking again per task would reread the same
 * relation before each write.
 */
export async function bulkPatchTasks(
  user: SessionUser,
  ids: number[],
  patch: BulkTaskPatch,
): Promise<number> {
  const rows = await prisma.task.findMany({
    where: { id: { in: ids } },
    select: { id: true, shot: { select: { projectId: true } }, asset: { select: { projectId: true } } },
  });
  // Same precedence as `resolveProjectIdForTask`: the shot first, then the asset.
  const projectIds = new Map(
    rows.map((row) => [row.id, row.shot?.projectId ?? row.asset?.projectId ?? null]),
  );
  for (const id of ids) {
    const projectId = projectIds.get(id);
    if (!projectId) throw notFound(`Task ${id} not found`);
    await TaskService.update(user, projectId, id, patch);
  }
  return ids.length;
}

/** Batch version patch (status): reuses `VersionService.update` per id. */
export async function bulkPatchVersions(
  user: SessionUser,
  ids: number[],
  status: VersionStatus,
): Promise<number> {
  const entities = await loadBulkEntities('versions', ids);
  for (const id of ids) {
    const projectId = entities.get(id)?.projectId ?? null;
    if (!projectId) throw notFound(`Version ${id} not found`);
    await VersionService.update(user, projectId, id, { status });
  }
  return ids.length;
}

/**
 * Status of a shot selection.
 *
 * This was the most glaring gap in multiple selection: it only offered "Assign" and "Delete", whereas
 * right-clicking a single shot offers nine actions, and the daily gesture of a production is precisely to
 * move thirty shots into retake at once.
 *
 * Each shot goes through `ShotService.update`, as for the singular action: same guards (writable project,
 * status belonging to this project's vocabulary), same ShotGrid arbitration, same audit trail. A failing shot
 * is counted separately rather than sinking the batch: out of fifty shots, losing everything over one would
 * be absurd, which is already the rule adopted for assignment.
 */
export async function bulkPatchShotStatus(
  user: SessionUser,
  ids: number[],
  pipelineStatusId: number | null,
): Promise<{ updated: number; failed: number }> {
  const shots = await prisma.shot.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, projectId: true },
  });
  if (shots.length === 0) throw notFound('No shot to update');
  const projectIds = new Set(shots.map((shot) => shot.projectId));
  if (projectIds.size !== 1) throw forbidden('All shots must belong to the same project');
  const [projectId] = projectIds;
  if (projectId === undefined) throw notFound('No shot to update');
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');

  let failed = 0;
  const touched: number[] = [];
  for (const shot of shots) {
    try {
      // `deferEvents`: the thirty unit `shot:update` events this loop used to emit each reloaded the WHOLE
      // kanban, for everyone who had it open: eight artists, one gesture, hundreds of requests almost all
      // cancelled in flight. A batch must be described by a single event.
      await ShotService.update(shot.id, projectId, { pipelineStatusId }, user.id, {
        deferEvents: true,
      });
      touched.push(shot.id);
    } catch {
      // Status refused by the ShotGrid arbitration, or locked shot: counted, not discarded.
      failed++;
    }
  }
  // A single pair of events, carrying the shots actually modified. Emitted after the loop: what failed must
  // not appear in the announced batch.
  ShotService.emitShotsUpdated(projectId, touched);
  const updated = touched.length;
  logAudit({
    userId: user.id,
    action: 'SHOT_BULK_STATUS',
    entityType: 'Shot',
    entityId: projectId,
    metadata: { ids: shots.map((shot) => shot.id), pipelineStatusId, updated, failed },
  });
  return { updated, failed };
}

/** Moves shots to a sequence (or out of any sequence if `null`) — ADMIN/SUPERVISOR. */
/**
 * Ticks or unticks steps on a selection of assets.
 *
 * Rights are re-checked for each asset: a selection may span several projects, and a single check at the head
 * would let all the others through.
 */
export async function bulkAssetDepartments(
  user: SessionUser,
  ids: number[],
  change: { add: number[]; remove: number[] },
): Promise<number> {
  await assertDeleteAccess(user, 'assets', ids);
  for (const id of ids) {
    await DepartmentService.attachHolderDepartments('asset', id, change.add);
    await DepartmentService.detachHolderDepartments('asset', id, change.remove);
  }
  return ids.length;
}

export async function bulkMoveShots(
  user: SessionUser,
  ids: number[],
  sequenceId: number | null,
): Promise<number> {
  if (!isManager(user.role)) throw forbidden('Supervisors and administrators only');
  // All shots must belong to the same project, consistent with the target sequence.
  const shots = await prisma.shot.findMany({
    where: { id: { in: ids } },
    select: { id: true, projectId: true },
  });
  if (shots.length !== ids.length) throw notFound('One or more shots were not found');
  const projectIds = new Set(shots.map((s) => s.projectId));
  if (projectIds.size !== 1) throw forbidden('All shots must belong to the same project');
  const [projectId] = projectIds;
  if (projectId === undefined) throw notFound('No shot to move');
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  if (sequenceId !== null) {
    const seq = await prisma.sequence.findUnique({ where: { id: sequenceId }, select: { projectId: true } });
    if (!seq || seq.projectId !== projectId) throw notFound('Invalid target sequence');
  }
  await prisma.shot.updateMany({ where: { id: { in: ids } }, data: { sequenceId } });
  logAudit({
    userId: user.id,
    action: 'SHOT_BULK_MOVE',
    entityType: 'Shot',
    entityId: ids[0],
    metadata: { ids, sequenceId },
  });
  return ids.length;
}
