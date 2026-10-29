// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Who can write on a task, according to its department.
 *
 * A thirty-person studio with twelve steps offers each artist the entire pipeline: a list
 * of twelve departments for someone who only touches one, and nothing prevents the
 * animator from pushing a compositing task forward by mistake.
 *
 * The rule is **readable in one sentence**: an artist writes on the tasks of their
 * departments, and on those assigned to them. They see all the others, because production
 * needs everyone to know where neighboring steps stand, and hiding others' work never
 * helped anyone do their own.
 *
 * Managers (ADMIN, SUPERVISOR) are not concerned: their job is precisely to intervene
 * everywhere.
 *
 * Pure logic: the decision is tested without a database, and the two callers (creation
 * and update) cannot diverge.
 */

export const TASK_POLICIES = ['open', 'department'] as const;
export type TaskPolicy = (typeof TASK_POLICIES)[number];

/** The default: what ReView did before the rule existed. */
export const DEFAULT_TASK_POLICY: TaskPolicy = 'open';

export function parseTaskPolicy(raw: string | null | undefined): TaskPolicy {
  return raw === 'department' ? 'department' : DEFAULT_TASK_POLICY;
}

export interface TaskWriteContext {
  policy: TaskPolicy;
  /** True for an ADMIN or a SUPERVISOR (effective role on the project). */
  isManager: boolean;
  /** The person's departments. */
  userDepartmentIds: number[];
  /** Department of the target task; null for a task without a step. */
  taskDepartmentId: number | null;
  /** Is the person the assignee of this task? */
  isAssignee: boolean;
}

/**
 * Can the person write on this task?
 *
 * In `open` mode, the historical rule applies as is: **only the assignee** touches their
 * task. The `department` mode **widens** it: the artist also writes on the tasks of their
 * steps, which is exactly what an animation lead expects from their department.
 *
 * In both cases, what a non-manager can *change* remains limited to status and checklist:
 * this function says which tasks they have access to, not what they can write on them.
 *
 * A task **without a department** is open under the restricted policy: it belongs to no
 * step, hence to nobody in particular, and refusing it to everyone would make it
 * unmodifiable. This is the case of a task born from a review feedback.
 */
export function canWriteTask(ctx: TaskWriteContext): boolean {
  if (ctx.isManager || ctx.isAssignee) return true;
  // Open mode: nothing is widened. Opening it here would give every artist control over
  // all tasks of the project, the opposite of what the policy aims for.
  if (ctx.policy === 'open') return false;
  if (ctx.taskDepartmentId === null) return true;
  return ctx.userDepartmentIds.includes(ctx.taskDepartmentId);
}

/**
 * The departments in which the person can create a task.
 *
 * This is what the screen offers, and where the promised readability is gained: a list
 * of two steps rather than twelve. A manager keeps the whole pipeline.
 */
export function writableDepartments(
  all: { id: number }[],
  ctx: Pick<TaskWriteContext, 'policy' | 'isManager' | 'userDepartmentIds'>,
): number[] {
  if (ctx.policy === 'open' || ctx.isManager) return all.map((d) => d.id);
  return all.filter((d) => ctx.userDepartmentIds.includes(d.id)).map((d) => d.id);
}
