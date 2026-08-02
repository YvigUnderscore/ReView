// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, TaskStatus, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { forbidden, notFound } from '../lib/errors';
import {
  resolveProjectIdForProject,
  resolveProjectIdForSequence,
  resolveProjectIdForShot,
  resolveProjectIdForAsset,
  resolveProjectIdForVersion,
  resolveProjectIdForMedia,
  resolveProjectIdForTask,
} from '../lib/pipeline';
import {
  softDeleteProjects,
  softDeleteSequences,
  softDeleteShots,
  softDeleteAssets,
  softDeleteVersions,
  softDeleteMedias,
  restoreProjects,
  restoreSequences,
  restoreShots,
  restoreAssets,
  restoreVersions,
  restoreMedias,
  purgeProject,
  purgeSequence,
  purgeShot,
  purgeAsset,
  purgeVersion,
  purgeMedia,
} from '../lib/trash';
import { logAudit } from './AuditService';
import { assertMediaManage } from './MediaService';
import * as TaskService from './TaskService';
import * as VersionService from './VersionService';

/**
 * Actions groupées (13.C). Chaque id est **revalidé individuellement** (accès projet +
 * RBAC métier) avant toute mutation : si un seul id échoue, rien n'est modifié.
 * Les domaines à corbeille (sequences/shots/assets/versions/media) partagent une passe
 * de validation puis une écriture en lot transactionnelle (`lib/trash`). Les patchs
 * (tasks/versions) réutilisent les services unitaires (émission temps réel + notifs).
 */

type SessionUser = { id: number; role: Role };

const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

export const DELETE_DOMAINS = ['projects', 'sequences', 'shots', 'assets', 'versions', 'media'] as const;
export type DeleteDomain = (typeof DELETE_DOMAINS)[number];

const RESOLVERS: Record<DeleteDomain, (id: number) => Promise<number | null>> = {
  projects: resolveProjectIdForProject,
  sequences: resolveProjectIdForSequence,
  shots: resolveProjectIdForShot,
  assets: resolveProjectIdForAsset,
  versions: resolveProjectIdForVersion,
  media: resolveProjectIdForMedia,
};

const SOFT_DELETE: Record<DeleteDomain, (ids: number[]) => Promise<void>> = {
  projects: softDeleteProjects,
  sequences: softDeleteSequences,
  shots: softDeleteShots,
  assets: softDeleteAssets,
  versions: softDeleteVersions,
  media: softDeleteMedias,
};

const RESTORE: Record<DeleteDomain, (ids: number[]) => Promise<void>> = {
  projects: restoreProjects,
  sequences: restoreSequences,
  shots: restoreShots,
  assets: restoreAssets,
  versions: restoreVersions,
  media: restoreMedias,
};

// Purge définitive (DB + MinIO) — fonctions unitaires bouclées (chaque purge gère son storage).
const PURGE: Record<DeleteDomain, (id: number) => Promise<void>> = {
  projects: purgeProject,
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
 * (projects/sequences/shots/assets) exigent ADMIN/SUPERVISOR ; media délègue à
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
    if (!projectId) throw notFound(`Élément ${id} introuvable`);
    if (!(await checkProjectAccess(user.id, user.role, projectId)))
      throw forbidden(`Accès refusé (${domain} ${id})`);
    if (domain === 'projects' || domain === 'sequences' || domain === 'shots' || domain === 'assets') {
      if (!manager) throw forbidden('Action réservée aux superviseurs/admins');
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
    if (!projectId) throw notFound(`Tâche ${id} introuvable`);
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
    if (!projectId) throw notFound(`Version ${id} introuvable`);
    await VersionService.update(user, projectId, id, { status });
  }
  return ids.length;
}

/** Déplacement de shots vers une séquence (ou hors séquence si `null`) — ADMIN/SUPERVISOR. */
export async function bulkMoveShots(
  user: SessionUser,
  ids: number[],
  sequenceId: number | null,
): Promise<number> {
  if (!isManager(user.role)) throw forbidden('Action réservée aux superviseurs/admins');
  // Tous les shots doivent appartenir au même projet, cohérent avec la séquence cible.
  const shots = await prisma.shot.findMany({
    where: { id: { in: ids } },
    select: { id: true, projectId: true },
  });
  if (shots.length !== ids.length) throw notFound('Un ou plusieurs shots introuvables');
  const projectIds = new Set(shots.map((s) => s.projectId));
  if (projectIds.size !== 1) throw forbidden('Les shots doivent appartenir au même projet');
  const [projectId] = projectIds;
  if (projectId === undefined) throw notFound('Aucun shot à déplacer');
  if (!(await checkProjectAccess(user.id, user.role, projectId))) throw forbidden('Accès au projet refusé');
  if (sequenceId !== null) {
    const seq = await prisma.sequence.findUnique({ where: { id: sequenceId }, select: { projectId: true } });
    if (!seq || seq.projectId !== projectId) throw notFound('Séquence cible invalide');
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
