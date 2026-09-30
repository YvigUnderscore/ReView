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
 * Actions groupées (13.C). Chaque id est **revalidé** (accès projet + RBAC métier) avant
 * toute mutation : si un seul id échoue, rien n'est modifié.
 * Les domaines à corbeille (episodes/sequences/shots/assets/versions/media) partagent une passe
 * de validation puis une écriture en lot transactionnelle (`lib/trash`). Les patchs
 * (tasks/versions) réutilisent les services unitaires (émission temps réel + notifs).
 *
 * **La revalidation est mutualisée, pas relâchée.** Ce qui ne dépend que du projet — le
 * projet est-il désignable, la personne y appartient-elle, avec quel rôle effectif — est
 * résolu UNE fois par projet pour tout le lot ; ce qui dépend de l'entité (auteur d'une
 * version, déposant d'un média) continue d'être vérifié id par id, dans l'ordre reçu.
 * Poser la même question deux cents fois coûtait plus de mille requêtes séquentielles avant
 * la première écriture, et ne protégeait rien de plus.
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

/** Domaines résolus par une lecture directe ; `media` a sa propre garde (cf. plus bas). */
type PipelineDomain = Exclude<DeleteDomain, 'media'>;

/**
 * Chaîne Version → projet, telle que la parcourt `resolveProjectIdForVersion`
 * (lib/pipeline) — reprise ici pour la lire en une seule requête sur tout un lot.
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

/** Même précédence que `resolveProjectIdForVersion` : asset direct, puis task→shot, puis task→asset. */
const projectIdOfVersion = (version: VersionProjectChain): number | null =>
  version.asset?.projectId ?? version.task?.shot?.projectId ?? version.task?.asset?.projectId ?? null;

/** Ce que le contrôle d'accès a besoin de savoir d'une entité : son projet, et son propriétaire. */
interface BulkEntity {
  projectId: number | null;
  /** Auteur d'une version ; `null` pour les domaines dont l'accès ne dépend que du rôle. */
  ownerId: number | null;
}

/**
 * Résout en UNE requête le projet porteur de tout un lot.
 *
 * Les résolveurs unitaires de `lib/pipeline` font une requête par identifiant — et trois
 * pour une version, à cause de ses relations imbriquées. Sur les deux cents ids que la
 * route autorise, cela faisait des centaines de lectures qui rendaient toutes le même
 * projet. La forme des `select` est recopiée telle quelle : même précédence, mêmes cas nuls.
 * Un id absent de la carte est un id introuvable, exactement comme un résolveur qui rendait
 * `null`.
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
 * Verdict d'accès projet mémorisé pour la durée d'un lot.
 *
 * L'utilisateur, son rôle global et `includeTrashed` ne varient pas d'un identifiant à
 * l'autre : le verdict ne dépend donc QUE du projet. Le redemander par entité, c'est
 * refaire deux cents fois le même `project.count` et la même lecture d'appartenance avant
 * la première écriture. On mémorise la promesse, pas sa valeur : deux demandes concurrentes
 * partagent la requête. La garde elle-même reste `checkProjectAccess` — on n'en réécrit
 * aucune règle, on cesse seulement de la reposer.
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

// Purge définitive (DB + MinIO) en lot : une passe de lecture, une passe de suppression,
// un seul `DeleteObjects` pour tout le lot (cf. lib/trash) — au lieu d'une purge unitaire
// bouclée, qui enchaînait des milliers d'allers-retours MinIO dans la requête HTTP.
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
 * Revalide l'accès à chaque id d'un domaine à corbeille. Les domaines pipeline
 * (projects/episodes/sequences/shots/assets) exigent ADMIN/SUPERVISOR ; media délègue à
 * `assertMediaManage` (uploader ou manager) ; versions exige auteur ou manager.
 *
 * Coût mesuré sur la base de démonstration, sélection accordée dans un seul projet : le
 * contrôle passe de 3 requêtes par plan (2 pour un ADMIN) à 3 pour tout le lot, quel qu'en
 * soit le nombre d'éléments.
 *
 * `fromTrash` marque les deux opérations qui, par nature, désignent des éléments déjà à la
 * corbeille — restauration et purge. Elles seules lèvent l'invariant du RBAC (« un projet
 * à la corbeille n'existe plus »), sans quoi la corbeille globale ne pourrait plus rendre
 * ni détruire ce qu'elle affiche. La mise à la corbeille, elle, garde la garde entière.
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
  // Les identifiants restent parcourus DANS L'ORDRE REÇU : le premier qui échoue rend la
  // même erreur qu'avant, avec le même identifiant dans le message.
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
 * Garde des médias en lot.
 *
 * `MediaService.assertMediaManage` reste la SEULE autorité sur la politique de projet
 * (projet désignable, appartenance, droit de contribuer, rôle de gestion) : elle est
 * appelée telle quelle sur le premier média de chaque projet rencontré. Ce qu'on cesse de
 * refaire, c'est de la reposer pour les cent quatre-vingt-dix-neuf suivants, dont le
 * verdict de projet est identique par construction — six requêtes par média, toutes les
 * mêmes, avant la moindre écriture.
 *
 * Seule la règle qui dépend RÉELLEMENT du média est rejouée pour les suivants : gérant du
 * projet, ou déposant de ce média-là. Si une règle par média venait s'ajouter à
 * `assertMediaManage`, c'est ici qu'il faudrait la reporter — d'où le nommage explicite.
 *
 * `fromTrash` n'entre pas en jeu : `assertMediaManage` contrôle l'accès projet sans
 * dérogation de corbeille, et cette voie-ci ne fait que la reprendre. Comportement
 * inchangé, y compris pour la restauration et la purge.
 */
async function assertMediaBulkManage(user: SessionUser, ids: number[]): Promise<void> {
  // Un seul identifiant : rien à mutualiser. La lecture préalable coûterait alors plus que
  // ce qu'elle épargne (mesuré : 13 requêtes contre 8), et la sélection d'un seul média est
  // un geste courant. On garde la garde d'origine, telle quelle.
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
  // Projets dont la garde complète est déjà passée, avec le rôle effectif qui y a servi.
  const cleared = new Map<number, Role | null>();
  for (const id of ids) {
    const media = byId.get(id);
    if (!media) throw notFound('Media not found');
    const projectId = media.projectId;
    if (projectId === null || !cleared.has(projectId)) {
      await assertMediaManage(id, user);
      // Projet non résolu : `assertMediaManage` a déjà levé, on n'arrive jamais ici.
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
 * Purge définitive en lot (corbeille → suppression DB + MinIO). Même passe de validation
 * d'accès que delete/restore, puis purge unitaire (chaque fonction gère la cascade DB et
 * le nettoyage storage après commit). Irréversible.
 */
export async function bulkPurge(user: SessionUser, domain: DeleteDomain, ids: number[]): Promise<number> {
  await assertDeleteAccess(user, domain, ids, true);
  // La purge d'un projet est réservée aux ADMIN — c'est la règle de la route unitaire
  // (`DELETE /api/projects/:projectId/purge`, requireRole(ADMIN)). `assertDeleteAccess` ne
  // demande qu'un « gestionnaire », qui inclut SUPERVISOR : sans ce contrôle, la voie
  // groupée rendait à un superviseur — dont l'accès projet est global — la destruction
  // définitive et irréversible de n'importe quel projet, base et stockage compris.
  if (domain === 'projects' && user.role !== Role.ADMIN)
    throw forbidden('Permanently purging a project is reserved to administrators');
  await PURGE[domain](ids);
  const a = AUDIT_ACTION[domain];
  logAudit({ userId: user.id, action: a.purge, entityType: a.type, entityId: ids[0], metadata: { ids } });
  return ids.length;
}

// ── Patchs groupés (statut / réassignation / déplacement) ────────────────────────

export interface BulkTaskPatch {
  status?: TaskStatus;
  assigneeId?: number | null;
}

/**
 * Patch de tâches en lot — réutilise `TaskService.update` (RBAC + notifs + temps réel) par id.
 * Le projet porteur, lui, est résolu pour tout le lot en une requête : le redemander par
 * tâche revenait à relire cinquante fois la même relation avant chaque écriture.
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
  // Même précédence que `resolveProjectIdForTask` : le plan d'abord, l'asset ensuite.
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

/** Patch de versions en lot (statut) — réutilise `VersionService.update` par id. */
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

  let failed = 0;
  const touched: number[] = [];
  for (const shot of shots) {
    try {
      // `deferEvents` : les trente `shot:update` unitaires que cette boucle émettait
      // rechargeaient trente fois le kanban ENTIER chez chaque personne qui l'avait
      // ouvert — huit artistes, un seul geste, des centaines de requêtes dont presque
      // toutes étaient annulées en vol. Un lot doit se décrire en un événement.
      await ShotService.update(shot.id, projectId, { pipelineStatusId }, user.id, {
        deferEvents: true,
      });
      touched.push(shot.id);
    } catch {
      // Statut refusé par l'arbitrage ShotGrid, plan verrouillé : compté, pas jeté.
      failed++;
    }
  }
  // Un seul couple d'événements, portant les plans réellement modifiés. Émis après la
  // boucle : ce qui a échoué ne doit pas figurer dans le lot annoncé.
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
