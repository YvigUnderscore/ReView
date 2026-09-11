// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { WatchTargetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectManage } from '../lib/projectRoles';
import type { SessionUser } from '../lib/shotgridAccess';
import { logAudit } from './AuditService';
import { notify } from './NotificationService';
import { setWatch } from './WatchService';
import { emitToProject } from './SocketService';
import {
  ASSIGNEE_SELECT,
  assertAssignable,
  toAssigneeView,
  type AssigneeView,
} from './EntityAssigneeService';

/**
 * Qui doit regarder cette version (Phase 49).
 *
 * La décision de review existait déjà (`ReviewDecisionService`) : elle dit ce qu'on a
 * conclu d'une livraison. Ce qui manquait, c'est le geste d'avant — **confier** cette
 * livraison à quelqu'un. Il se disait de vive voix ou dans un fil de discussion, donc il
 * se perdait : personne ne pouvait ouvrir ReView et répondre à « qu'est-ce qu'on attend de
 * moi ? ». L'encart « Assigned to me » de la page Reviews lit exactement cette liste-là.
 *
 * Assigner n'ouvre aucun droit et n'en retire aucun : c'est une attente, pas une
 * délégation. La décision reste réservée au superviseur du projet, et un artiste à qui on
 * confie une version la regarde et la commente — comme il pouvait déjà le faire.
 */

/** Au-delà, ce n'est plus une assignation mais une diffusion : c'est à quoi sert la playlist. */
export const MAX_REVIEWERS = 20;

/** La version, son projet et de quoi écrire la notification. */
async function loadVersion(versionId: number) {
  const version = await prisma.version.findFirst({
    where: { id: versionId, deletedAt: null },
    select: { id: true, name: true, taskId: true, assetId: true },
  });
  if (!version) throw notFound('Version not found');
  return version;
}

/** Les personnes confiées à cette version, photos signées — ordre stable (par id). */
export async function listReviewers(versionId: number): Promise<AssigneeView[]> {
  const version = await prisma.version.findFirst({
    where: { id: versionId, deletedAt: null },
    select: { reviewers: { select: ASSIGNEE_SELECT, orderBy: { id: 'asc' } } },
  });
  if (!version) throw notFound('Version not found');
  return Promise.all(version.reviewers.map(toAssigneeView));
}

/**
 * Remplace la liste des personnes chargées de la review d'une version.
 *
 * `set` plutôt qu'`connect`/`disconnect` : l'appelant envoie la liste qu'il veut voir, et
 * deux enregistrements concurrents ne peuvent pas laisser un assigné fantôme que personne
 * n'a choisi. Même arbitrage que `EntityAssigneeService.setAssignees`, et même garde-fou
 * sur qui peut recevoir du travail — sinon l'un des deux chemins devient la porte de
 * service de l'autre.
 */
export async function setReviewers(
  actor: SessionUser,
  projectId: number,
  versionId: number,
  userIds: number[],
): Promise<AssigneeView[]> {
  const version = await loadVersion(versionId);
  await assertProjectWritable(projectId);
  await assertProjectManage(actor.id, actor.role, projectId);
  const wanted = [...new Set(userIds)];
  await assertAssignable(projectId, wanted);

  const before = new Set((await listReviewers(versionId)).map((person) => person.id));
  const updated = await prisma.version.update({
    where: { id: versionId },
    data: { reviewers: { set: wanted.map((id) => ({ id })) } },
    select: { reviewers: { select: ASSIGNEE_SELECT, orderBy: { id: 'asc' } } },
  });

  logAudit({
    userId: actor.id,
    action: 'version.reviewers',
    entityType: 'Version',
    entityId: versionId,
    metadata: { userIds: wanted },
  });
  emitToProject(projectId, 'version:update', {
    projectId,
    id: version.id,
    taskId: version.taskId,
    assetId: version.assetId,
  });

  const added = wanted.filter((id) => !before.has(id) && id !== actor.id);
  if (added.length > 0) await announce(added, projectId, versionId, version.name);
  return Promise.all(updated.reviewers.map(toAssigneeView));
}

/**
 * Prévient les nouveaux assignés — et les abonne à la version.
 *
 * La notification d'assignation seule aurait laissé le reviewer dans le noir jusqu'à ce
 * qu'il pense à rouvrir l'écran : les retours et la décision qui suivent sont précisément
 * ce qu'il attend. Le suivi (32.G) les lui fait parvenir, et il reste le sien — le retirer
 * de la liste ne le désabonne pas, puisqu'il a pu le poser lui-même entre-temps.
 *
 * La référence pointe le premier média de la version : c'est ce qui rend la notification
 * navigable jusqu'à l'écran de review (même choix que la décision).
 */
async function announce(
  userIds: number[],
  projectId: number,
  versionId: number,
  versionName: string,
): Promise<void> {
  const firstMedia = await prisma.mediaObject.findFirst({
    where: { versionId, deletedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  await Promise.all(
    userIds.map(async (userId) => {
      await setWatch(userId, WatchTargetType.VERSION, versionId, true);
      await notify({
        userId,
        type: 'REVIEW_ASSIGNED',
        messageKey: 'notification.reviewAssigned',
        params: { version: versionName },
        projectId,
        referenceId: firstMedia?.id ?? null,
      });
    }),
  );
}
