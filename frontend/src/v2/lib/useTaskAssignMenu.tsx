// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Layers, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { useDepartments } from './departmentsApi';
import { useProjectMembers } from './useProjectRole';
import { useUndoToast } from './useUndoToast';
import { UNASSIGNED } from './assignMenu';
import { useT } from '../i18n';
import type { MenuEntry } from './menuSpec';

/**
 * "Assign" and "Department" submenus for **one** task.
 *
 * `useAssignMenu` works at the scale of a shot or an asset: it picks a step,
 * then a person, and writes to the matching task. That is the right gesture from a
 * list — but in front of a shot's cards, one does not search for the step, it is in
 * view: one wants to put someone on *this* task.
 *
 * No new route: `PATCH /api/tasks/:id` has always accepted the assignee and the department,
 * and the service keeps the relation and the key aligned.
 */
export function useTaskAssignMenu(projectId: number) {
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
  const members = useProjectMembers(projectId);
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);

  /** What the change touches: the parent's tree, the kanban, the task lists. */
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['shot'] });
    void qc.invalidateQueries({ queryKey: ['asset'] });
    void qc.invalidateQueries({ queryKey: qk.projectTasks(projectId) });
    void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });
  };

  /** The bare write: lets its failure bubble up, so that undo can report it. */
  const write = async (taskId: number, body: Record<string, unknown>): Promise<void> => {
    await api.patch(`/api/tasks/${taskId}`, body);
    refresh();
  };

  /**
   * Writes, then confirms with "Undo".
   *
   * `previous` is the state from before, read on the task at click time: assigning someone by
   * mistake in a menu of fifteen names is the most common error on the screen, and nothing
   * said who was there before. A server write cannot be undone with Ctrl+Z (it is already
   * with the others, and ShotGrid may have arbitrated): it is a named step, not a history.
   */
  const patch = async (taskId: number, body: Record<string, unknown>, previous: Record<string, unknown>) => {
    try {
      await write(taskId, body);
      done(t('assign.done'), () => write(taskId, previous));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('assign.failed'));
    }
  };

  /** "Assign": project members, the current one being checked. */
  const assignEntry = (
    task: { id: number; assigneeId: number | null },
    canManage: boolean,
  ): MenuEntry | null => {
    if (!canManage || members.length === 0) return null;
    return {
      kind: 'submenu',
      id: 'task-assign',
      label: t('assign.menu'),
      icon: <UserPlus size={14} />,
      items: [
        {
          kind: 'radiogroup',
          id: `task-assign-${task.id}`,
          value: task.assigneeId != null ? String(task.assigneeId) : UNASSIGNED,
          onValueChange: (value) => {
            void patch(
              task.id,
              { assigneeId: value === UNASSIGNED ? null : Number(value) },
              { assigneeId: task.assigneeId },
            );
          },
          items: [
            { id: `task-assign-${task.id}-none`, value: UNASSIGNED, label: t('assign.unassigned') },
            ...members.map((member) => ({
              id: `task-assign-${task.id}-${member.id}`,
              value: String(member.id),
              label: member.name,
            })),
          ],
        },
      ],
    };
  };

  /**
   * "Department": the step the task occupies in the pipe.
   *
   * It decides the kanban column, the pipe order and who has the right
   * to write there — changing it is therefore not a simple label, and the menu shows it
   * in the same place as the assignment because both are set in the same movement.
   */
  const departmentEntry = (
    task: { id: number; department: string | null },
    canManage: boolean,
  ): MenuEntry | null => {
    if (!canManage || departments.length === 0) return null;
    return {
      kind: 'submenu',
      id: 'task-department',
      label: t('departments.menu'),
      icon: <Layers size={14} />,
      items: [
        {
          kind: 'radiogroup',
          id: `task-dept-${task.id}`,
          value: task.department ?? UNASSIGNED,
          onValueChange: (value) => {
            void patch(
              task.id,
              { department: value === UNASSIGNED ? null : value },
              { department: task.department },
            );
          },
          items: [
            { id: `task-dept-${task.id}-none`, value: UNASSIGNED, label: t('pipeline.dept.none') },
            ...departments.map((department) => ({
              id: `task-dept-${task.id}-${department.id}`,
              value: department.key,
              label: department.name,
            })),
          ],
        },
      ],
    };
  };

  /**
   * Signature of what these two entries read: people and steps.
   *
   * Both builders are new on every render (they are closures): a screen that
   * memoises its cards cannot list them as a dependency without re-rendering everything on each
   * keystroke. It lists this string in their place — it changes when the menu changes, and at
   * that moment only. The kanban depends on it so as not to replay a thousand cards per letter.
   */
  const epoch = [
    projectId,
    ...members.map((m) => `${m.id}:${m.name}`),
    ...departments.map((d) => `${d.id}:${d.key}:${d.name}`),
  ].join('|');

  return { assignEntry, departmentEntry, epoch };
}
