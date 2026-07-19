import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';
import { notify } from './NotificationService';
import { notifyWatchers } from './WatchService';
import { emitToProject } from './SocketService';
import { emitWebhookEvent } from './WebhookService';
import { badRequest, conflict, notFound } from '../lib/errors';

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
  if (!existing) throw notFound('Statut introuvable');
  const status = await prisma.$transaction(async (tx) => {
    await clearDefaultIfNeeded(tx, input.isDefault);
    return tx.reviewStatus.update({ where: { id }, data: input });
  });
  logAudit({ userId: user.id, action: 'review_status.update', entityType: 'ReviewStatus', entityId: id });
  return status;
}

export async function deleteStatus(user: SessionUser, id: number) {
  const used = await prisma.reviewDecision.count({ where: { statusId: id } });
  if (used > 0) throw conflict(`Statut utilisé par ${used} décision(s) — suppression impossible`);
  try {
    await prisma.reviewStatus.delete({ where: { id } });
  } catch {
    throw notFound('Statut introuvable');
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
) {
  const version = await prisma.version.findFirst({
    where: { id: versionId, deletedAt: null },
    select: { id: true, name: true, taskId: true, assetId: true, authorId: true },
  });
  if (!version) throw notFound('Version introuvable');
  const status = await prisma.reviewStatus.findUnique({ where: { id: statusId } });
  if (!status) throw badRequest('Statut de review inconnu');

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
    action: 'version.decision',
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
  // Notifie l'auteur de la version (sauf s'il pose lui-même la décision).
  if (version.authorId && version.authorId !== user.id) {
    await notify({
      userId: version.authorId,
      type: 'review_decision',
      content: `Décision « ${status.name} » sur la version ${version.name}${comment ? ` — ${comment}` : ''}`,
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
    content: `Décision « ${status.name} » sur la version ${version.name}`,
    referenceId: firstMedia?.id ?? null,
    exclude: [user.id, ...(version.authorId ? [version.authorId] : [])],
  });
  // Webhooks sortants (36.D).
  emitWebhookEvent('review.decision', {
    versionId,
    versionName: version.name,
    projectId,
    status: status.name,
    isApproval: status.isApproval,
    isRetake: status.isRetake,
    comment: comment ?? null,
    decidedBy: user.id,
  });
  return decision;
}

/** Historique des décisions d'une version (récent → ancien). */
export async function history(versionId: number) {
  return prisma.reviewDecision.findMany({
    where: { versionId },
    orderBy: { createdAt: 'desc' },
    include: { status: true, author: { select: { id: true, name: true } } },
  });
}
