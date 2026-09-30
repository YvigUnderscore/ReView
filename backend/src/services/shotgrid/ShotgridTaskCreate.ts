// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { asEntityRef } from './shotgridMapper';
import { findByLocal, upsertLink } from './shotgridLinks';
import type { ShotgridWriter } from './ShotgridWriter';
import type { ShotgridClient } from './ShotgridClient';

/**
 * Une tâche née dans ReView remonte sur le site (Phase 50).
 *
 * Une tâche créée depuis un retour de review n'existait QUE chez nous : elle n'apparaissait
 * ni dans la production du studio, ni dans le My Tasks de l'artiste côté site, et la
 * réconciliation ne pouvait pas la reprendre — faute de lien, `pullTasks` ne la voyait
 * jamais et la corbeille distante ne l'atteignait pas davantage.
 *
 * `ShotgridSteps.createTaskFromStep` écrit d'abord sur le site puis ici, parce que c'est
 * l'utilisateur qui attend derrière un formulaire. Ici, c'est l'inverse : la tâche locale
 * existe déjà — un retour de review ne peut pas dépendre de la joignabilité du site — et
 * l'écriture distante passe par la file, comme tous les autres `push`. Le lien est posé au
 * retour du site ; tant qu'il manque, la tâche est simplement une tâche locale de plus.
 */

/** Ce qu'il faut pour écrire : la connexion, le writer, et au nom de qui l'on écrit. */
export interface TaskCreateContext {
  connectionId: number;
  client: ShotgridClient;
  writer: ShotgridWriter;
  asUserLogin: string | null;
}

/**
 * Crée sur le site la Task locale `taskId`, et la relie.
 *
 * Idempotent : un job rejoué sur une tâche déjà reliée ne crée pas de doublon. Rien ne
 * lève — une écriture ShotGrid en échec ne doit pas défaire une action locale déjà
 * acquise ; le journal en garde la trace.
 */
export async function pushTaskCreation(ctx: TaskCreateContext, taskId: number): Promise<void> {
  const existing = await findByLocal(ctx.connectionId, 'task', taskId);
  if (existing) return;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, name: true, shotId: true, assetId: true, assigneeId: true, department: true },
  });
  if (!task) return;

  const parentKind = task.shotId ? ('shot' as const) : ('asset' as const);
  const parentId = task.shotId ?? task.assetId;
  if (!parentId) return;
  const parent = await findByLocal(ctx.connectionId, parentKind, parentId);
  if (!parent) {
    // Le plan ou l'asset porteur n'existe pas sur le site : il n'y a rien à quoi accrocher
    // la tâche. C'est le cas d'un projet mi-ShotGrid mi-local, et ce n'est pas une panne.
    logger.info({ taskId, parentKind, parentId }, 'Task non poussée : parent absent du site');
    return;
  }

  const step = await resolveStep(ctx, parentKind, parentId, task.department);
  const assignee = task.assigneeId ? await findByLocal(ctx.connectionId, 'user', task.assigneeId) : null;

  const created = await ctx.writer.create(
    'Task',
    {
      content: task.name,
      entity: { type: parent.sgType, id: parent.sgId },
      ...(step ? { step: { type: 'Step', id: step.id } } : {}),
      ...(assignee ? { task_assignees: [{ type: 'HumanUser', id: assignee.sgId }] } : {}),
    },
    { asUserLogin: ctx.asUserLogin },
  );

  await upsertLink({
    connectionId: ctx.connectionId,
    localType: 'task',
    localId: task.id,
    sgType: 'Task',
    sgId: created.id,
    data: {
      // Le lien décrit le côté distant : le nom d'étape tel que le site l'écrit, et non la
      // clé normalisée du département local (même forme que `createTaskFromStep`).
      stepName: step?.name ?? null,
      sgAssignees: [],
      sgStatusCode: null,
      durationMinutes: null,
    },
  });
  logger.info({ taskId, sgId: created.id, step: step?.id ?? null }, 'Task créée sur le site depuis ReView');
}

/**
 * L'étape distante à donner à la tâche : celle qu'emploient déjà ses voisines.
 *
 * Le catalogue `Step` d'un site accumule les homonymes — ArtFX en a deux nommées
 * « modeling », et seule l'une des deux est celle du projet. On ne devine donc pas : on lit
 * l'étape d'une tâche voisine du MÊME parent et du même département, déjà reliée au site.
 * Sans voisine reliée, la tâche part sans étape plutôt qu'avec la mauvaise — la
 * réconciliation la rangera quand un humain l'aura placée.
 */
async function resolveStep(
  ctx: TaskCreateContext,
  parentKind: 'shot' | 'asset',
  parentId: number,
  department: string | null,
): Promise<{ id: number; name: string | null } | null> {
  if (!department) return null;
  const siblings = await prisma.task.findMany({
    where: { ...(parentKind === 'shot' ? { shotId: parentId } : { assetId: parentId }), department },
    select: { id: true },
  });
  for (const sibling of siblings) {
    const link = await findByLocal(ctx.connectionId, 'task', sibling.id);
    if (!link) continue;
    const remote = await ctx.client.findById('Task', link.sgId, ['step']);
    const ref = asEntityRef(remote?.step);
    if (ref) return { id: ref.id, name: ref.name ?? null };
  }
  return null;
}
