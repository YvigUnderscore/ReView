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
 * Approval circuit (Phase 31): customizable review statuses (per studio) and
 * per-version decisions (recorded by SUPERVISOR+, with history). The current
 * decision is denormalized on Version.reviewStatusId; the full history lives in
 * ReviewDecision. RBAC is asserted in the routes.
 */

type SessionUser = { id: number; role: Role };

/**
 * Badge for a decision in the team channel. It stays **outside the catalog**: an emoji is not text
 * to translate, but it precedes the sentence in all fourteen languages, so it travels as the `{icon}` parameter.
 */
const decisionIcon = (s: { isApproval: boolean; isRetake: boolean }): string =>
  s.isApproval ? '✅' : s.isRetake ? '🔁' : '🟠';

/** Standard statuses created on first access (idempotent, existing instances included). */
const DEFAULT_STATUSES = [
  { name: 'Pending', color: '#F5A623', order: 0, isDefault: true },
  { name: 'Approved', color: '#2ECC71', order: 1, isApproval: true },
  { name: 'Retake', color: '#E74C3C', order: 2, isRetake: true },
  { name: 'CBB', color: '#3498DB', order: 3 }, // Could Be Better: approved with reservations
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
 * Statuses offered for a given project.
 *
 * On a project linked to ShotGrid, only the statuses that really exist there make sense: recording a
 * decision the site does not know would surface nowhere, and the screen ended up mixing ReView's original
 * vocabulary with the studio's: "approved" twice, "redo" three times. So we restrict to the established
 * mapping. A standalone project keeps the full list.
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

/** Only one default status at a time: setting isDefault removes it from the others. */
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

/** Records a decision on a version (with history) and updates the current decision. */
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
  // 48: the decision is propagated to the production registry. Queued, so the artist does not
  // wait for ShotGrid, and a site outage does not fail the review.
  await enqueuePush(projectId, { type: 'version-status', versionId, actorId: user.id });
  // Common reference for ALL recipients: the version's first media, the only id the front end
  // can open. The author used to receive the VERSION id and followers the MEDIA id for the same event,
  // so one of the two links was wrong by construction, and it was the one of the person most concerned.
  const firstMedia = await prisma.mediaObject.findFirst({
    where: { versionId },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  // Notifies the author of the version (unless they set the decision themselves).
  if (version.authorId && version.authorId !== user.id) {
    await notify({
      userId: version.authorId,
      kind: 'reviewDecision',
      messageKey: 'notification.decision',
      params: { status: status.name, version: version.name },
      projectId,
      referenceId: firstMedia?.id ?? null,
    });
  }
  // Followers (32.G): decision set on the version/shot/asset chain.
  await notifyWatchers({
    versionId,
    projectId,
    messageKey: 'notification.decision',
    params: { status: status.name, version: version.name },
    referenceId: firstMedia?.id ?? null,
    exclude: [user.id, ...(version.authorId ? [version.authorId] : [])],
  });
  // Outgoing webhooks (36.D).
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
  // Team messaging (42.B, issue #67): studio-wide signal of decisions. A batch stays silent
  // version by version and announces only one line: thirty messages for a review session would
  // make the channel unusable.
  if (options.chat !== false) {
    const icon = decisionIcon(status);
    void notifyChat('chat.decision', { icon, status: status.name, version: version.name });
  }
  return decision;
}

/**
 * Same decision on a selection of versions (Reviews page).
 *
 * The selection often spans several projects, since the page mixes them by default. Each project is
 * therefore rechecked: the **effective** supervision right (38.E) and the status belonging to the
 * vocabulary offered there. A refused version is counted, not discarded: on forty shots, losing everything
 * for one would be absurd.
 */
export async function decideMany(
  user: SessionUser,
  versionIds: number[],
  statusId: number,
  comment?: string,
): Promise<{ updated: number; failed: number }> {
  const status = await prisma.reviewStatus.findUnique({ where: { id: statusId } });
  if (!status) throw badRequest('Unknown review status');

  // One check per project, not per version: the same selection often holds a hundred
  // versions for two projects. The verdict is memoized, refusals included.
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
    void notifyChat('chat.decisionBulk', { icon: decisionIcon(status), status: status.name, count: updated });
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

/** Decision history of a version (newest to oldest). */
export async function history(versionId: number) {
  return prisma.reviewDecision.findMany({
    where: { versionId },
    orderBy: { createdAt: 'desc' },
    include: { status: true, author: { select: { id: true, name: true } } },
  });
}

/** The two answers asked of a client: "approved" and "needs revision". */
export interface GuestDecisionStatuses {
  approval: { id: number; name: string; color: string } | null;
  retake: { id: number; name: string; color: string } | null;
}

/**
 * The vocabulary offered to a guest, derived from the studio's flags.
 *
 * A client has no need to choose between "Pending", "CBB" and "Retake": these are pipeline states, not
 * answers. We offer only the two statuses the studio itself marked as approval and as retake: its own
 * vocabulary, without imposing ours, and without exposing the rest of its list.
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
 * A guest's opinion on a version: **an opinion, not a verdict**.
 *
 * The difference from `decide` rests on a missing row: `Version.reviewStatusId` is not touched. The
 * opinion is recorded in the history, attributed to the client and to the link they came through, and the
 * supervisor decides. Someone outside the studio does not move a shot's state for the whole team, least of
 * all by clicking the wrong thing.
 *
 * There is no ShotGrid propagation either: the production registry receives the studio's decisions, not its
 * clients' opinions.
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

  // The status must be one of the TWO we offer: accepting any identifier would let a guest
  // set "Pending" or any internal status.
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
  // The author of the delivery and the followers learn of the opinion as they would of a
  // decision: it is the same event for them, only the authority behind it differs.
  if (version.authorId) {
    await notify({
      userId: version.authorId,
      kind: 'reviewDecision',
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
      // A webhook consumer must be able to tell an opinion from a decision: without this
      // flag, an integration would take a client's opinion for a pipeline state.
      advisory: true,
    },
  });
  return decision;
}
