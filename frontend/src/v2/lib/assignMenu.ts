// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../i18n';
import type { MenuRadioItem } from './menuSpec';

/**
 * Builds the "Assign" submenu — pure logic, no React and no network.
 *
 * The gesture reads as "assign Alice to this asset", but what is written is the assignment of a
 * **task**: an asset has no owner, each of its steps does. The menu therefore mirrors the pipeline
 * — one level per department, then the people.
 */

export const UNASSIGNED = 'none';

export interface AssignDepartment {
  id: number;
  name: string;
  /** True if the entity already carries a task for this department. */
  hasTask: boolean;
  /** Person currently on this task, if there is one. */
  assigneeId: number | null;
}

export interface AssignMember {
  id: number;
  name: string;
}

export interface AssignGroup {
  departmentId: number;
  label: string;
  /** True when the gesture is impossible: project driven from ShotGrid, task missing. */
  disabled: boolean;
  items: MenuRadioItem[];
  value: string;
}

/**
 * One group per assignable department.
 *
 * On a project driven from ShotGrid, departments without a task are shown but disabled: the task
 * must be born there, and hiding the entry would suggest the step does not exist — whereas the
 * pipeline plans it.
 */
export function assignGroups(
  departments: AssignDepartment[],
  members: AssignMember[],
  options: { linked: boolean; t: (key: MessageKey) => string },
): AssignGroup[] {
  return departments.map((department) => ({
    departmentId: department.id,
    label: department.name,
    disabled: options.linked && !department.hasTask,
    value: department.assigneeId != null ? String(department.assigneeId) : UNASSIGNED,
    items: [
      ...members.map((member) => ({
        id: `assign-${department.id}-${member.id}`,
        value: String(member.id),
        label: member.name,
      })),
      {
        id: `assign-${department.id}-none`,
        value: UNASSIGNED,
        label: options.t('assign.unassigned'),
      },
    ],
  }));
}

/** The body sent to the server for a given choice. */
export function assignBody(
  departmentId: number,
  value: string,
): { userId: number | null; departmentIds: number[] } {
  return {
    userId: value === UNASSIGNED ? null : Number(value),
    departmentIds: [departmentId],
  };
}

/**
 * An entity's departments, seen from its tasks.
 *
 * An entity may carry a task in a department it does not "declare": the pipeline evolves, the tasks
 * remain. Both sources are therefore merged, without duplicates.
 */
export function departmentsOf(
  declared: { id: number; name: string }[],
  tasks: {
    departmentId: number | null;
    departmentRef?: { id: number; name: string } | null;
    assignee: { id: number } | null;
  }[],
): AssignDepartment[] {
  const byId = new Map<number, AssignDepartment>();
  for (const d of declared) {
    byId.set(d.id, { id: d.id, name: d.name, hasTask: false, assigneeId: null });
  }
  for (const task of tasks) {
    if (task.departmentId == null) continue;
    let existing = byId.get(task.departmentId);
    // A task may live in a step the entity does not declare: the pipeline evolves, the tasks
    // remain. Omitting it would deprive the menu of the only step actually in progress on the entity.
    if (!existing && task.departmentRef) {
      existing = {
        id: task.departmentRef.id,
        name: task.departmentRef.name,
        hasTask: false,
        assigneeId: null,
      };
      byId.set(existing.id, existing);
    }
    if (existing) {
      existing.hasTask = true;
      // Several tasks in the same department: the first assigned one counts for the tick — the menu
      // shows a state, it does not pretend to summarise all the tasks.
      existing.assigneeId ??= task.assignee?.id ?? null;
    }
  }
  return [...byId.values()];
}
