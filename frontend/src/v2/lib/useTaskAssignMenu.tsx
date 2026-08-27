// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Layers, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { useDepartments } from './departmentsApi';
import { useProjectMembers } from './useProjectRole';
import { UNASSIGNED } from './assignMenu';
import { useT } from '../i18n';
import type { MenuEntry } from './menuSpec';

/**
 * Sous-menus « Assigner » et « Département » d'**une** tâche.
 *
 * `useAssignMenu` travaille à l'échelle d'un plan ou d'un asset : il choisit une étape,
 * puis une personne, et écrit sur la tâche correspondante. C'est le bon geste depuis une
 * liste — mais devant les cartes d'un plan, on ne cherche pas l'étape, on l'a sous les
 * yeux : on veut mettre quelqu'un sur *cette* tâche-là.
 *
 * Aucune route nouvelle : `PATCH /api/tasks/:id` accepte l'assigné et le département
 * depuis toujours, et c'est le service qui tient la relation et la clé alignées.
 */
export function useTaskAssignMenu(projectId: number) {
  const t = useT();
  const qc = useQueryClient();
  const members = useProjectMembers(projectId);
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);

  /** Ce que la modification touche : l'arbre du parent, le kanban, les listes de tâches. */
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['shot'] });
    void qc.invalidateQueries({ queryKey: ['asset'] });
    void qc.invalidateQueries({ queryKey: qk.projectTasks(projectId) });
    void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });
  };

  const patch = async (taskId: number, body: Record<string, unknown>) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, body);
      toast.success(t('assign.done'));
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('assign.failed'));
    }
  };

  /** « Assigner » : les membres du projet, celui en place étant coché. */
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
            void patch(task.id, { assigneeId: value === UNASSIGNED ? null : Number(value) });
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
   * « Département » : l'étape que la tâche occupe dans le pipe.
   *
   * C'est elle qui décide de la colonne du kanban, de l'ordre du pipe et de qui a le droit
   * d'y écrire — la changer n'est donc pas un simple étiquetage, et le menu la montre au
   * même endroit que l'assignation parce que les deux se règlent dans le même mouvement.
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
            void patch(task.id, { department: value === UNASSIGNED ? null : value });
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

  return { assignEntry, departmentEntry };
}
