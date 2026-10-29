// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Check, Layers, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { useT } from '../i18n';
import { useDepartments, useToggleEntityDepartment } from './departmentsApi';
import { useProjectMembers } from './useProjectRole';
import { useSgConnection } from './shotgridApi';
import { assignBody, assignGroups, departmentsOf } from './assignMenu';
import type { MenuEntry } from './menuSpec';

/**
 * "Assign" and "Departments" submenus for an asset or a shot.
 *
 * Assigning an asset to someone used to mean opening each of its tasks one by one;
 * declaring the steps it goes through meant opening its settings panel. Both
 * gestures now fit in the context menu, where the entity is visible.
 */

type Holder = 'asset' | 'shot';
const SEGMENT: Record<Holder, 'assets' | 'shots'> = { asset: 'assets', shot: 'shots' };

export interface AssignTarget {
  id: number;
  /** Steps declared by the entity. */
  departments?: { id: number; name: string }[];
  /** Its tasks, to know who is already on it. */
  tasks?: {
    departmentId: number | null;
    departmentRef?: { id: number; name: string } | null;
    assignee: { id: number } | null;
  }[];
}

export function useAssignMenu(projectId: number, holder: Holder) {
  const t = useT();
  const qc = useQueryClient();
  const members = useProjectMembers(projectId);
  const { data: allDepartments = [] } = useDepartments(projectId, projectId > 0);
  const { data: connection } = useSgConnection(projectId);
  const linked = Boolean(connection?.active);

  const assign = useMutation({
    mutationFn: ({ id, ...body }: { id: number; userId: number | null; departmentIds: number[] }) =>
      api.post<{ updated: number; created: number }>(`/api/${SEGMENT[holder]}/${id}/assign`, body),
  });

  const refresh = (id: number) => {
    void qc.invalidateQueries({ queryKey: [holder, id] });
    void qc.invalidateQueries({ queryKey: [SEGMENT[holder], projectId] });
    void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });
    void qc.invalidateQueries({ queryKey: qk.projectTasks(projectId) });
  };

  /**
   * "Assign" submenu: one level per department, then the people. Absent when
   * the project has neither an assignable member nor a step — there would be nothing to choose.
   */
  const assignEntry = (target: AssignTarget, canManage: boolean): MenuEntry | null => {
    if (!canManage || members.length === 0) return null;
    // An **empty** list is not the absence of a list: an asset that declares no
    // step must be offered the project's pipe, not an absent menu.
    const declared = target.departments?.length ? target.departments : allDepartments;
    const departments = departmentsOf(declared, target.tasks ?? []);
    if (departments.length === 0) return null;
    const groups = assignGroups(departments, members, { linked, t });
    return {
      kind: 'submenu',
      id: 'assign',
      label: t('assign.menu'),
      icon: <UserPlus size={14} />,
      items: groups.map((group) => ({
        kind: 'submenu' as const,
        id: `assign-dept-${group.departmentId}`,
        label: group.label,
        items: [
          {
            kind: 'radiogroup' as const,
            id: `assign-group-${group.departmentId}`,
            value: group.value,
            onValueChange: (value) => {
              if (value === group.value) return;
              void (async () => {
                try {
                  await assign.mutateAsync({ id: target.id, ...assignBody(group.departmentId, value) });
                  toast.success(t('assign.done'));
                  refresh(target.id);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t('assign.failed'));
                }
              })();
            },
            // A department without a task on a project driven from ShotGrid stays visible
            // but inert: hiding the step would suggest the pipe does not plan for it.
            items: group.items.map((item) => ({ ...item, disabled: group.disabled })),
          },
        ],
      })),
    };
  };

  return { assignEntry, hasMembers: members.length > 0 };
}

/**
 * "Departments" submenu: tick the steps the entity goes through, without opening its
 * settings. The toggle is targeted (add/remove), not a replacement of the list —
 * two quick clicks would otherwise cancel each other out.
 */
export function useDepartmentMenu(projectId: number, holder: Holder, id: number) {
  const t = useT();
  const { data: allDepartments = [] } = useDepartments(projectId, projectId > 0);
  const toggle = useToggleEntityDepartment(projectId, SEGMENT[holder], id);

  const entry = (current: { id: number }[] | undefined, canManage: boolean): MenuEntry | null => {
    if (!canManage || allDepartments.length === 0) return null;
    const owned = new Set((current ?? []).map((d) => d.id));
    return {
      kind: 'submenu',
      id: 'departments',
      label: t('departments.menu'),
      icon: <Layers size={14} />,
      items: allDepartments.map((department) => ({
        id: `department-${department.id}`,
        label: department.name,
        // Tick at the icon's position: writing it into the label would shift the names
        // relative to one another and mix data and presentation.
        icon: owned.has(department.id) ? <Check size={13} /> : <span className="size-3" />,
        onSelect: () => {
          void (async () => {
            try {
              await toggle.mutateAsync(
                owned.has(department.id) ? { remove: [department.id] } : { add: [department.id] },
              );
              toast.success(t('departments.updated'));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : t('common.error.generic'));
            }
          })();
        },
      })),
    };
  };

  return { entry };
}
