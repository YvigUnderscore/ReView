// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';
import { notify } from './NotificationService';
import { notifyWatchers } from './WatchService';
import { emitToProject } from './SocketService';
import { publish as publishApiEvent } from './ApiEventService';
import { notifyChat } from './ChatNotifyService';
import { badRequest, conflict, notFound } from '../lib/errors';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { assertProjectManage } from '../lib/projectRoles';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/**
 * Circuit d'approbation (Phase 31) : statuts de review personnalisables (studio)
 * et décisions par version (posées par SUPERVISOR+, historisées). La décision
 * courante est dénormalisée sur Version.reviewStatusId ; l'historique complet
 * vit dans ReviewDecision. RBAC asserté dans les routes.
 */

type SessionUser = { id: number; role: Role };

/** Statuts classiques créés au premier accès (idempotent, instances existantes incluses). */
const DEFAULT_STATUSES = [
  { name: 'Pending', color: '#F5A623', order: 0, isDefault: true },
  { name: 'Approved', color: '#2ECC71', order: 1, isApproval: true },
  { name: 'Retake', color: '#E74C3C', order: 2, isRetake: true },
  { name: 'CBB', color: '#3498DB', order: 3 }, // Could Be Better — validé avec réserves
];

export async function ensureDefaultStatuses(): Promise<void> {
  const count = await prisma.reviewStatus.count();
  if (count > 0) return;
  await prisma.reviewStatus.createMany({ data: DEFAULT_STATUSES, skipDuplicates: true });
}

export async function listStatuses() {
  await ensureDefaultStatuses();
  return prisma.reviewStatus.findMany({ orderBy: [{ order: 'asc' }, { id: 'asc' }] });
}

/**
 * Statuts proposés pour un projet donné.
 *
 * Sur un projet relié à ShotGrid, seuls les statuts qui existent réellement là-bas ont
 * un sens : poser une décision que le site ne connaît pas ne remonterait nulle part, et
 * l'écran se retrouvait à mélanger le vocabulaire d'origine de ReView avec celui du
 * studio — deux fois « approuvé », trois fois « à refaire ». On restreint donc à la
 * correspondance établie. Un projet autonome garde la liste complète.
 */
export async function listStatusesForProject(projectId: number) {
  const all = await listStatuses();
  const connection = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  if (!connection?.active) return all;

  const settings = (connection.settings ?? {}) as { versionStatusMap?: Record<string, number> };
  const mapped = new Set(Object.values(settings.versionStatusMap ?? {}));
  if (mapped.size === 0) return all;
  return all.filter((s) => mapped.has(s.id));
}

export interface StatusInput {
  name: string;
  color: string;
  order?: number;
  isApproval?: boolean;
  isRetake?: boolean;
  isDefault?: boolean;
}

/** Un seul statut par défaut à la fois : poser isDefault le retire des autres. */
async function clearDefaultIfNeeded(tx: Prisma.TransactionClient, isDefault?: boolean) {
  if (isDefault) await tx.reviewStatus.updateMany({ data: { isDefault: false } });
}

export async function createStatus(user: SessionUser, input: StatusInput) {
  const status = await prisma.$transaction(async (tx) => {
    await clearDefaultIfNeeded(tx, input.isDefault);
    return tx.reviewStatus.create({ data: input });
  });
  logAudit({
    userId: user.id,
    action: 'review_status.create',
    entityType: 'ReviewStatus',
    entityId: status.id,
  });
  return status;
}

export async function updateStatus(user: SessionUser, id: number, input: Partial<StatusInput>) {
  const existing = await prisma.reviewStatus.findUnique({ where: { id } });
  if (!existing) throw notFound('Status not found');
  const status = await prisma.$transaction(async (tx) => {
    await clearDefaultIfNeeded(tx, input.isDefault);
    return tx.reviewStatus.update({ where: { id }, data: input });
  });
  logAudit({ userId: user.id, action: 'review_status.update', entityType: 'ReviewStatus', entityId: id });
  return status;
}

export async function deleteStatus(user: SessionUser, id: number) {
  const used = await prisma.reviewDecision.count({ where: { statusId: id } });
  if (used > 0) throw conflict(`This status is used by ${used} decision(s) — it cannot be deleted`);
  try {
    await prisma.reviewStatus.delete({ where: { id } });
  } catch {
    throw notFound('Status not found');
  }
  logAudit({ userId: user.id, action: 'review_status.delete', entityType: 'ReviewStatus', entityId: id });
}

/** Pose une décision sur une version (historisée) et met à jour la décision courante. */
export async function decide(
  user: SessionUser,
  projectId: number,
  versionId: number,
  statusId: number,
  comment?: string,
  options: { chat?: boolean } = {},
) {
  const version = await prisma.version.findFirst({
    where: { id: versionId, deletedAt: null },
    select: { id: true, name: true, taskId: true, assetId: true, authorId: true },
  });
  if (!version) throw notFound('Version not found');
  const status = await prisma.reviewStatus.findUnique({ where: { id: statusId } });
  if (!status) throw badRequest('Unknown review status');

  const decision = await prisma.$transaction(async (tx) => {
    const d = await tx.reviewDecision.create({
      data: { versionId, statusId, comment: comment ?? null, authorId: user.id },
      include: { status: true, author: { select: { id: true, name: true } } },
    });
    await tx.version.update({ where: { id: versionId }, data: { reviewStatusId: statusId } });
    return d;
  });

  logAudit({
    userId: user.id,
    action: 'VERSION_DECISION',
    entityType: 'Version',
    entityId: versionId,
    metadata: { status: status.name, comment: comment ?? null },
  });
  emitToProject(projectId, 'version:update', {
    projectId,
    id: version.id,
    taskId: version.taskId,
    assetId: version.assetId,
  });
  // 48 : la décision remonte au registre de production. Mise en file — l'artiste ne
  // doit pas attendre ShotGrid, et une panne du site ne fait pas échouer la review.
  await enqueuePush(projectId, { type: 'version-status', versionId, actorId: user.id });
  // Notifie l'auteur de la version (sauf s'il pose lui-même la décision).
  if (version.authorId && version.authorId !== user.id) {
    await notify({
      userId: version.authorId,
      type: 'review_decision',
      messageKey: 'notification.decision',
      params: { status: status.name, version: version.name },
      projectId,
      referenceId: versionId,
    });
  }
  // Suiveurs (32.G) : décision posée sur la chaîne version/shot/asset (référence =
  // premier média de la version, navigable vers la review).
  const firstMedia = await prisma.mediaObject.findFirst({
    where: { versionId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  await notifyWatchers({
    versionId,
    projectId,
    messageKey: 'notification.decision',
    params: { status: status.name, version: version.name },
    referenceId: firstMedia?.id ?? null,
    exclude: [user.id, ...(version.authorId ? [version.authorId] : [])],
  });
  // Webhooks sortants (36.D).
  publishApiEvent('review.decision', {
    projectId,
    entityType: 'version',
    entityId: versionId,
    actorId: user.id,
    payload: {
      versionId,
      versionName: version.name,
      projectId,
      status: status.name,
      isApproval: status.isApproval,
      isRetake: status.isRetake,
      comment: comment ?? null,
      decidedBy: user.id,
    },
  });
  // Messagerie d'équipe (42.B — №67) : signal studio-wide des décisions. Un lot le tait
  // version par version et n'annonce qu'une ligne : trente messages pour une session de
  // review rendraient le canal inutilisable.
  if (options.chat !== false) {
    const emoji = status.isApproval ? '✅' : status.isRetake ? '🔁' : '🟠';
    void notifyChat(`${emoji} Décision « ${status.name} » sur la version ${version.name}`);
  }
  return decision;
}

/**
 * Même décision sur une sélection de versions (page Reviews).
 *
 * La sélection traverse volontiers plusieurs projets — la page les mélange par défaut.
 * Chaque projet est donc revérifié : droit de supervision **effectif** (38.E) et
 * appartenance du statut au vocabulaire offert là-bas. Une version refusée est comptée,
 * pas jetée : sur quarante plans, tout perdre pour un seul serait absurde.
 */
export async function decideMany(
  user: SessionUser,
  versionIds: number[],
  statusId: number,
  comment?: string,
): Promise<{ updated: number; failed: number }> {
  const status = await prisma.reviewStatus.findUnique({ where: { id: statusId } });
  if (!status) throw badRequest('Unknown review status');

  // Un contrôle par projet, pas par version : la même sélection porte souvent cent
  // versions pour deux projets. Le verdict est mémorisé, refus compris.
  const allowed = new Map<number, boolean>();
  const allowsProject = async (projectId: number): Promise<boolean> => {
    const known = allowed.get(projectId);
    if (known !== undefined) return known;
    const ok = await (async () => {
      try {
        await assertProjectManage(user.id, user.role, projectId);
        const offered = await listStatusesForProject(projectId);
        return offered.some((s) => s.id === statusId);
      } catch {
        return false;
      }
    })();
    allowed.set(projectId, ok);
    return ok;
  };

  let updated = 0;
  let failed = 0;
  for (const versionId of versionIds) {
    const projectId = await resolveProjectIdForVersion(versionId);
    if (!projectId || !(await allowsProject(projectId))) {
      failed++;
      continue;
    }
    try {
      await decide(user, projectId, versionId, statusId, comment, { chat: false });
      updated++;
    } catch {
      failed++;
    }
  }
  if (updated > 0) {
    const emoji = status.isApproval ? '✅' : status.isRetake ? '🔁' : '🟠';
    void notifyChat(`${emoji} Décision « ${status.name} » sur ${updated} version(s)`);
  }
  logAudit({
    userId: user.id,
    action: 'VERSION_DECISION_BULK',
    entityType: 'Version',
    entityId: statusId,
    metadata: { status: status.name, ids: versionIds, updated, failed },
  });
  return { updated, failed };
}

/** Historique des décisions d'une version (récent → ancien). */
export async function history(versionId: number) {
  return prisma.reviewDecision.findMany({
    where: { versionId },
    orderBy: { createdAt: 'desc' },
    include: { status: true, author: { select: { id: true, name: true } } },
  });
}

/** Les deux réponses qu'on demande à un client : « c'est bon » et « à revoir ». */
export interface GuestDecisionStatuses {
  approval: { id: number; name: string; color: string } | null;
  retake: { id: number; name: string; color: string } | null;
}

/**
 * Le vocabulaire offert à un invité, dérivé des drapeaux du studio.
 *
 * Un client n'a pas à arbitrer entre « Pending », « CBB » et « Retake » : ce sont des états
 * de pipeline, pas des réponses. On ne lui propose que les deux statuts que le studio a
 * lui-même marqués comme validation et comme retake — son vocabulaire, donc, sans lui
 * imposer le nôtre, et sans lui exposer le reste de sa liste.
 */
export async function guestStatuses(projectId: number): Promise<GuestDecisionStatuses> {
  const all = await listStatusesForProject(projectId);
  const pick = (flag: 'isApproval' | 'isRetake') => {
    const found = all.find((s) => s[flag]);
    return found ? { id: found.id, name: found.name, color: found.color } : null;
  };
  return { approval: pick('isApproval'), retake: pick('isRetake') };
}

/**
 * Avis d'un invité sur une version — **un avis, pas un verdict**.
 *
 * La différence avec `decide` tient en une ligne absente : `Version.reviewStatusId` n'est
 * pas touché. L'avis s'inscrit dans l'historique, attribué au client et au lien par lequel
 * il est arrivé, et le superviseur tranche. Quelqu'un d'extérieur au studio ne fait pas
 * bouger l'état d'un plan pour toute l'équipe — surtout pas en cliquant à côté.
 *
 * Il n'y a pas non plus de remontée ShotGrid : le registre de production reçoit les
 * décisions du studio, pas les avis de ses clients.
 */
export async function decideAsGuest(
  guest: { name: string; shareLinkId: number },
  projectId: number,
  versionId: number,
  statusId: number,
  comment?: string,
) {
  const version = await prisma.version.findFirst({
    where: { id: versionId, deletedAt: null },
    select: { id: true, name: true, authorId: true },
  });
  if (!version) throw notFound('Version not found');

  // Le statut doit être l'un des DEUX que l'on propose : accepter un identifiant quelconque
  // laisserait un invité poser « Pending » ou n'importe quel statut interne.
  const offered = await guestStatuses(projectId);
  const status = [offered.approval, offered.retake].find((s) => s?.id === statusId);
  if (!status) throw badRequest('This status is not offered to share links');

  const decision = await prisma.reviewDecision.create({
    data: {
      versionId,
      statusId,
      comment: comment ?? null,
      guestName: guest.name,
      shareLinkId: guest.shareLinkId,
    },
    include: { status: true },
  });

  logAudit({
    action: 'SHARE_DECISION',
    entityType: 'Version',
    entityId: versionId,
    metadata: { shareLinkId: guest.shareLinkId, status: status.name, guestName: guest.name },
  });

  const firstMedia = await prisma.mediaObject.findFirst({
    where: { versionId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  // L'auteur de la livraison et les suiveurs apprennent l'avis comme ils apprendraient une
  // décision : c'est le même événement pour eux, seule l'autorité derrière change.
  if (version.authorId) {
    await notify({
      userId: version.authorId,
      type: 'review_decision',
      messageKey: 'notification.clientDecision',
      params: { name: guest.name, status: status.name, version: version.name },
      projectId,
      referenceId: firstMedia?.id ?? null,
    });
  }
  await notifyWatchers({
    versionId,
    projectId,
    messageKey: 'notification.clientDecision',
    params: { name: guest.name, status: status.name, version: version.name },
    referenceId: firstMedia?.id ?? null,
    exclude: version.authorId ? [version.authorId] : [],
  });
  emitToProject(projectId, 'version:update', { projectId, id: version.id });
  publishApiEvent('review.decision', {
    projectId,
    entityType: 'version',
    entityId: versionId,
    actorId: null,
    payload: {
      versionId,
      versionName: version.name,
      projectId,
      status: status.name,
      guestName: guest.name,
      shareLinkId: guest.shareLinkId,
      comment: comment ?? null,
      // Le consommateur d'un webhook doit pouvoir distinguer un avis d'une décision : sans
      // ce drapeau, une intégration prendrait l'avis d'un client pour un état de pipeline.
      advisory: true,
    },
  });
  return decision;
}
