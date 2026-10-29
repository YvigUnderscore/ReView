// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { asEntityRef } from './shotgridMapper';
import { findByLocal, upsertLink } from './shotgridLinks';
import type { ShotgridWriter } from './ShotgridWriter';
import type { ShotgridClient } from './ShotgridClient';

/**
 * A task created in ReView goes up to the site (Phase 50).
 *
 * A task created from a review note existed ONLY on our side: it appeared neither in the studio's production nor in the artist's My Tasks on the site side, and
 * reconciliation could not take it back — for lack of a link, `pullTasks` never saw it and the remote trash did not reach it either.
 *
 * `ShotgridSteps.createTaskFromStep` writes to the site first and then here, because the user waits behind a form. Here, it is the reverse: the local task already
 * exists — a review note cannot depend on the site being reachable — and the remote write goes through the queue, like all other `push`es. The link is set on the site's
 * return; until it is, the task is simply one more local task.
 */

/** What is needed to write: the connection, the writer, and in whose name we write. */
export interface TaskCreateContext {
  connectionId: number;
  client: ShotgridClient;
  writer: ShotgridWriter;
  asUserLogin: string | null;
}

/**
 * Creates on the site the local Task `taskId`, and links it.
 *
 * Idempotent: a job replayed on an already linked task creates no duplicate. Nothing throws — a failed ShotGrid write must not undo a local action already acquired;
 * the journal keeps the trace of it.
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
        // The carrying shot or asset does not exist on the site: there is nothing to hang the task on. This is the case of a project half on ShotGrid, half local, and it is not an outage.
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
            // The link describes the remote side: the step name as the site writes it, not the normalized key of the local department (same shape as `createTaskFromStep`).
      stepName: step?.name ?? null,
      sgAssignees: [],
      sgStatusCode: null,
      durationMinutes: null,
    },
  });
  logger.info({ taskId, sgId: created.id, step: step?.id ?? null }, 'Task créée sur le site depuis ReView');
}

/**
 * The remote step to give the task: the one its neighbours already use.
 *
 * A site's `Step` catalogue accumulates homonyms — ArtFX has two named "modeling", and only one of them is the project's. So we do not guess: we read the step of a
 * neighbouring task of the SAME parent and the same department, already linked to the site. Without a linked neighbour, the task goes out without a step rather than with the
 * wrong one — reconciliation will file it once a human has placed it.
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
