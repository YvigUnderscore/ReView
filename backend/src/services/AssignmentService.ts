// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, badRequest, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectManage } from '../lib/projectRoles';
import { sgStepToTaskType } from './shotgrid/shotgridMapper';
import type { SessionUser } from '../lib/shotgridAccess';
import * as DepartmentService from './DepartmentService';
import * as TaskService from './TaskService';
import { assertAssignable } from './EntityAssigneeService';

/**
 * Assign someone to an asset or to a shot.
 *
 * An asset carries no assignee, and never will: work is split by step, and it is the **task** that has an
 * owner. ShotGrid does it the same way (`task_assignees` lives on `Task`), so adding a field of our own would
 * make the two models diverge at the first round trip.
 *
 * "Assign Alice to this asset" is therefore: for each targeted department, put Alice on the matching task,
 * creating that task if it is missing. The shortcut is the everyday production language; the data written
 * remains that of the pipeline.
 */

export type AssignHolder = 'asset' | 'shot';

export interface AssignInput {
  holder: AssignHolder;
  id: number;
  /** `null` unassigns. */
  userId: number | null;
  /** Targeted departments. Empty = all those the entity already goes through. */
  departmentIds?: number[];
}

export interface AssignResult {
  /** Tasks actually modified. */
  updated: number;
  /** Tasks created because they did not exist; never on a project driven from ShotGrid. */
  created: number;
}

/** The project of the owning entity, and its existence. */
async function resolveProject(holder: AssignHolder, id: number): Promise<number> {
  const row =
    holder === 'asset'
      ? await prisma.asset.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } })
      : await prisma.shot.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } });
  if (!row) throw notFound(holder === 'asset' ? 'Asset not found' : 'Shot not found');
  return row.projectId;
}

/**
 * Who can receive work: **a single** guard, that of `EntityAssigneeService`.
 *
 * This service kept a private copy that had diverged: it did not test `disabledAt`, so a disabled account
 * refused as the owner of a shot remained acceptable as the assignee of a task. Two copies of the same
 * refusals are a service door to one another: assign the task, and the entity follows.
 */

/** Is the project driven from ShotGrid? If so, no task is created there. */
async function isDrivenByShotgrid(projectId: number): Promise<boolean> {
  const connection = await prisma.shotgridConnection.findUnique({
    where: { projectId },
    select: { active: true },
  });
  return Boolean(connection?.active);
}

/**
 * Assigns a person to the entity, department by department.
 *
 * Without a department specified, we target the entity's existing tasks: this is the common case, "give this
 * asset to Alice" means "everything still to be done on it".
 */
export async function assignEntity(user: SessionUser, input: AssignInput): Promise<AssignResult> {
  const projectId = await resolveProject(input.holder, input.id);
  await assertProjectWritable(projectId);
  await assertProjectManage(user.id, user.role, projectId);
  if (input.userId !== null) await assertAssignable(projectId, [input.userId]);

  const departmentIds = input.departmentIds ?? [];
  if (departmentIds.length > 0) await DepartmentService.assertDepartmentsOfProject(projectId, departmentIds);

  const where = input.holder === 'asset' ? { assetId: input.id } : { shotId: input.id };
  const tasks = await prisma.task.findMany({
    where: {
      ...where,
      ...(departmentIds.length > 0 ? { departmentId: { in: departmentIds } } : {}),
    },
    select: { id: true, assigneeId: true, departmentId: true },
  });

  let created = 0;
  const targets = tasks.map((t) => t.id);

  // Requested departments with no task yet: we create one, unless the pipeline is driven from ShotGrid. The
  // task must be born there, otherwise the next sync would see two of them.
  const missing = departmentIds.filter((d) => !tasks.some((t) => t.departmentId === d));
  if (missing.length > 0) {
    if (await isDrivenByShotgrid(projectId)) {
      throw badRequest('This project is driven from ShotGrid: create the task there first', 'TASK_MISSING');
    }
    const departments = await DepartmentService.listForProject(projectId);
    for (const departmentId of missing) {
      const department = departments.find((d) => d.id === departmentId);
      if (!department) continue;
      const task = await prisma.task.create({
        data: {
          name: department.name,
          type: sgStepToTaskType(department.key),
          department: department.key,
          departmentId,
          status: TaskStatus.TODO,
          ...where,
        },
        select: { id: true },
      });
      targets.push(task.id);
      created += 1;
    }
  }

  if (targets.length === 0) throw badRequest('Nothing to assign on this entity', 'NO_TASK');

  let updated = 0;
  for (const taskId of targets) {
    const before = tasks.find((t) => t.id === taskId);
    // Nothing to do if the person is already there: avoid the notification and the push to ShotGrid that a
    // useless write would trigger.
    if (before && before.assigneeId === input.userId) continue;
    await TaskService.setAssignee(user, projectId, taskId, input.userId);
    updated += 1;
  }

  // A department someone is assigned on is one the entity goes through: attaching it avoids having to
  // declare it a second time by hand.
  if (departmentIds.length > 0) {
    await DepartmentService.attachHolderDepartments(input.holder, input.id, departmentIds);
  }

  return { updated, created };
}

/**
 * Same action on a selection. Access is re-checked for each entity: a selection may span several projects,
 * and a single check at the head would let the others through.
 */
export async function assignMany(
  user: SessionUser,
  holder: AssignHolder,
  ids: number[],
  input: Omit<AssignInput, 'holder' | 'id'>,
): Promise<AssignResult & { skipped: number }> {
  let updated = 0;
  let created = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      const result = await assignEntity(user, { ...input, holder, id });
      updated += result.updated;
      created += result.created;
    } catch (err) {
      // An inaccessible entity, or one without a task, does not make the others fail: on a selection of fifty
      // assets, losing everything over one would be absurd.
      if (isExpected(err)) skipped += 1;
      else throw err;
    }
  }
  return { updated, created, skipped };
}

/** The expected refusals of a single entity, which must not sink the selection. */
function isExpected(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return err.statusCode === 403 || err.statusCode === 404 || err.statusCode === 400;
}

/** Roles that can be proposed for assignment, for the interface. */
export const ASSIGNABLE_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR, Role.ARTIST];
