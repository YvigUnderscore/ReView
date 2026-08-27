// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, TaskStatus, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import * as DepartmentService from './DepartmentService';
import { checkProjectAccess } from '../middleware/rbac';
import { forbidden, notFound } from '../lib/errors';
import {
  resolveProjectIdForProject,
  resolveProjectIdForEpisode,
  resolveProjectIdForSequence,
  resolveProjectIdForShot,
  resolveProjectIdForAsset,
  resolveProjectIdForVersion,
  resolveProjectIdForMedia,
  resolveProjectIdForTask,
} from '../lib/pipeline';
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
  purgeProject,
  purgeEpisode,
  purgeSequence,
  purgeShot,
  purgeAsset,
  purgeVersion,
  purgeMedia,
} from '../lib/trash';
import { logAudit } from './AuditService';
import { assertMediaManage } from './MediaService';
import * as ShotService from './ShotService';
import * as TaskService from './TaskService';
import * as VersionService from './VersionService';

/**
 * Actions groupées (13.C). Chaque id est **revalidé individuellement** (accès projet +
 * RBAC métier) avant toute mutation : si un seul id échoue, rien n'est modifié.
 * Les domaines à corbeille (episodes/sequences/shots/assets/versions/media) partagent une passe
 * de validation puis une écriture en lot transactionnelle (`lib/trash`). Les patchs
 * (tasks/versions) réutilisent les services unitaires (émission temps réel + notifs).
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

const RESOLVERS: Record<DeleteDomain, (id: number) => Promise<number | null>> = {
  projects: resolveProjectIdForProject,
  episodes: resolveProjectIdForEpisode,
  sequences: resolveProjectIdForSequence,
  shots: resolveProjectIdForShot,
  assets: resolveProjectIdForAsset,
  versions: resolveProjectIdForVersion,
  media: resolveProjectIdForMedia,
};

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

// Purge définitive (DB + MinIO) — fonctions unitaires bouclées (chaque purge gère son storage).
const PURGE: Record<DeleteDomain, (id: number) => Promise<void>> = {
  projects: purgeProject,
  episodes: purgeEpisode,
  sequences: purgeSequence,
  shots: purgeShot,
  assets: purgeAsset,
  versions: purgeVersion,
  media: purgeMedia,
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
 * Revalide l'accès à chaque id d'un domaine à corbeille. Les domaines pipeline
 * (projects/episodes/sequences/shots/assets) exigent ADMIN/SUPERVISOR ; media délègue à
 * `assertMediaManage` (uploader ou manager) ; versions exige auteur ou manager.
 */
async function assertDeleteAccess(user: SessionUser, domain: DeleteDomain, ids: number[]): Promise<void> {
  if (domain === 'media') {
    for (const id of ids) await assertMediaManage(id, user);
    return;
  }
  const manager = isManager(user.role);
  for (const id of ids) {
    const projectId = await RESOLVERS[domain](id);
    if (!projectId) throw notFound(`Item ${id} not found`);
    if (!(await checkProjectAccess(user.id, user.role, projectId)))
      throw forbidden(`Access denied (${domain} ${id})`);
    if (
      domain === 'projects' ||
      domain === 'episodes' ||
      domain === 'sequences' ||
      domain === 'shots' ||
      domain === 'assets'
    ) {
      if (!manager) throw forbidden('Supervisors and administrators only');
    } else if (domain === 'versions') {
      const v = await prisma.version.findUnique({ where: { id }, select: { authorId: true } });
      if (!manager && v?.authorId !== user.id)
        throw forbidden("Suppression réservée à l'auteur ou un superviseur");
    }
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
  await assertDeleteAccess(user, domain, ids);
  await RESTORE[domain](ids);
  const a = AUDIT_ACTION[domain];
  logAudit({ userId: user.id, action: a.restore, entityType: a.type, entityId: ids[0], metadata: { ids } });
  return ids.length;
}

/**
 * Purge définitive en lot (corbeille → suppression DB + MinIO). Même passe de validation
 * d'accès que delete/restore, puis purge unitaire (chaque fonction gère la cascade DB et
 * le nettoyage storage après commit). Irréversible.
 */
export async function bulkPurge(user: SessionUser, domain: DeleteDomain, ids: number[]): Promise<number> {
  await assertDeleteAccess(user, domain, ids);
  // La purge d'un projet est réservée aux ADMIN — c'est la règle de la route unitaire
  // (`DELETE /api/projects/:projectId/purge`, requireRole(ADMIN)). `assertDeleteAccess` ne
  // demande qu'un « gestionnaire », qui inclut SUPERVISOR : sans ce contrôle, la voie
  // groupée rendait à un superviseur — dont l'accès projet est global — la destruction
  // définitive et irréversible de n'importe quel projet, base et stockage compris.
  if (domain === 'projects' && user.role !== Role.ADMIN)
    throw forbidden('Permanently purging a project is reserved to administrators');
  for (const id of ids) await PURGE[domain](id);
  const a = AUDIT_ACTION[domain];
  logAudit({ userId: user.id, action: a.purge, entityType: a.type, entityId: ids[0], metadata: { ids } });
  return ids.length;
}

// ── Patchs groupés (statut / réassignation / déplacement) ────────────────────────

export interface BulkTaskPatch {
  status?: TaskStatus;
  assigneeId?: number | null;
}

/** Patch de tâches en lot — réutilise `TaskService.update` (RBAC + notifs + temps réel) par id. */
export async function bulkPatchTasks(
  user: SessionUser,
  ids: number[],
  patch: BulkTaskPatch,
): Promise<number> {
  for (const id of ids) {
    const projectId = await resolveProjectIdForTask(id);
    if (!projectId) throw notFound(`Task ${id} not found`);
    await TaskService.update(user, projectId, id, patch);
  }
  return ids.length;
}

/** Patch de versions en lot (statut) — réutilise `VersionService.update` par id. */
export async function bulkPatchVersions(
  user: SessionUser,
  ids: number[],
  status: VersionStatus,
): Promise<number> {
  for (const id of ids) {
    const projectId = await resolveProjectIdForVersion(id);
    if (!projectId) throw notFound(`Version ${id} not found`);
    await VersionService.update(user, projectId, id, { status });
  }
  return ids.length;
}

/**
 * Statut d'une sélection de plans.
 *
 * C'était le manque le plus criant de la sélection multiple : elle n'offrait que
 * « Assigner » et « Supprimer », là où le clic droit sur un seul plan propose neuf actions —
 * et où le geste quotidien d'une production consiste précisément à passer trente plans en
 * retake d'un coup.
 *
 * Chaque plan passe par `ShotService.update`, comme au singulier : mêmes garde-fous
 * (projet inscriptible, statut appartenant bien au vocabulaire de ce projet), même
 * arbitrage ShotGrid, même trace d'audit. Un plan qui échoue est compté à part plutôt que
 * de faire tomber le lot — sur cinquante plans, tout perdre pour un seul serait absurde,
 * c'est déjà la règle retenue pour l'assignation.
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

  let updated = 0;
  let failed = 0;
  for (const shot of shots) {
    try {
      await ShotService.update(shot.id, projectId, { pipelineStatusId }, user.id);
      updated++;
    } catch {
      // Statut refusé par l'arbitrage ShotGrid, plan verrouillé : compté, pas jeté.
      failed++;
    }
  }
  logAudit({
    userId: user.id,
    action: 'SHOT_BULK_STATUS',
    entityType: 'Shot',
    entityId: projectId,
    metadata: { ids: shots.map((shot) => shot.id), pipelineStatusId, updated, failed },
  });
  return { updated, failed };
}

/** Déplacement de shots vers une séquence (ou hors séquence si `null`) — ADMIN/SUPERVISOR. */
/**
 * Cocher ou décocher des étapes sur une sélection d'assets.
 *
 * Les droits sont revérifiés pour chaque asset : une sélection peut traverser plusieurs
 * projets, et un seul contrôle en tête laisserait passer tous les autres.
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
  // Tous les shots doivent appartenir au même projet, cohérent avec la séquence cible.
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
