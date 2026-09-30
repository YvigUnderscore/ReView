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
  const { done } = useUndoToast();
  const members = useProjectMembers(projectId);
  const { data: departments = [] } = useDepartments(projectId, projectId > 0);

  /** Ce que la modification touche : l'arbre du parent, le kanban, les listes de tâches. */
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['shot'] });
    void qc.invalidateQueries({ queryKey: ['asset'] });
    void qc.invalidateQueries({ queryKey: qk.projectTasks(projectId) });
    void qc.invalidateQueries({ queryKey: qk.projectBoard(projectId) });
  };

  /** L'écriture nue : elle laisse remonter son échec, pour que l'annulation puisse le dire. */
  const write = async (taskId: number, body: Record<string, unknown>): Promise<void> => {
    await api.patch(`/api/tasks/${taskId}`, body);
    refresh();
  };

  /**
   * Écrit, puis confirme avec « Annuler ».
   *
   * `previous` est l'état d'avant, lu sur la tâche au moment du clic : assigner quelqu'un par
   * mégarde dans un menu de quinze noms est l'erreur la plus banale de l'écran, et rien ne
   * disait qui était là avant. Une écriture serveur ne se défait pas d'un Ctrl+Z (elle est
   * déjà chez les autres, et ShotGrid a pu arbitrer) : c'est un cran nommé, pas un historique.
   */
  const patch = async (taskId: number, body: Record<string, unknown>, previous: Record<string, unknown>) => {
    try {
      await write(taskId, body);
      done(t('assign.done'), () => write(taskId, previous));
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
   * Signature de ce que ces deux entrées lisent : les personnes et les étapes.
   *
   * Les deux constructeurs sont neufs à chaque rendu (ce sont des fermetures) : un écran qui
   * mémoïse ses cartes ne peut pas les lister en dépendance sans tout re-rendre à chaque
   * frappe. Il liste cette chaîne à leur place — elle change quand le menu change, et à ce
   * moment-là seulement. Le kanban en dépend pour ne pas rejouer mille cartes par lettre.
   */
  const epoch = [
    projectId,
    ...members.map((m) => `${m.id}:${m.name}`),
    ...departments.map((d) => `${d.id}:${d.key}:${d.name}`),
  ].join('|');

  return { assignEntry, departmentEntry, epoch };
}
