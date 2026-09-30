// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL_KEY } from '../../../lib/taskStatus';
import PipelineStatusSelect from '../../../components/shotgrid/PipelineStatusSelect';
import { useProjectMembers } from '../../../lib/useProjectRole';
import type { TaskStatus } from '../../../types/api';
import { useProjectActivity, type ActivityTask, type ProjectActivity } from './useProjectActivity';
import { useT } from '../../../i18n';

/**
 * Les tâches à traiter, les plus urgentes d'abord — statut et assignation au clic, pour qui
 * gère le projet.
 *
 * Les deux mutations écrivent d'abord le cache, appellent ensuite : un statut qui met une
 * seconde à s'afficher se re-clique, et se re-clique à tort. L'échec invalide, ce qui remet
 * la ligne dans l'état du serveur.
 *
 * `limit` est ce que la carte peut montrer — la hauteur réglée traduite en lignes : une
 * carte haute liste réellement plus de tâches, là où le plafond figé de vingt-cinq lignes
 * débordait d'une petite carte et laissait du vide dans une grande.
 */

export default function TasksWidget({
  projectId,
  canManage,
  limit,
}: {
  projectId: number;
  canManage: boolean;
  limit: number;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { tasks } = useProjectActivity(projectId);
  const members = useProjectMembers(projectId);

  const patchTask = (taskId: number, patch: Partial<ActivityTask>) =>
    qc.setQueryData<ProjectActivity>(qk.projectActivity(projectId), (old) =>
      old
        ? { ...old, tasks: old.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)) }
        : old,
    );
  const rollback = () => qc.invalidateQueries({ queryKey: qk.projectActivity(projectId) });

  // Les deux valeurs avancent ensemble : le référentiel porte le vocabulaire du site,
  // l'énumération reste ce sur quoi s'appuient le kanban, les statistiques et l'API v1.
  const setStatus = async (taskId: number, next: { statusId: number | null; legacyStatus: TaskStatus }) => {
    patchTask(taskId, { status: next.legacyStatus, pipelineStatusId: next.statusId });
    try {
      await api.patch(`/api/tasks/${taskId}`, {
        status: next.legacyStatus,
        ...(next.statusId ? { pipelineStatusId: next.statusId } : {}),
      });
    } catch {
      void rollback();
    }
  };

  const assign = async (taskId: number, assigneeId: string) => {
    const id = assigneeId ? Number(assigneeId) : null;
    const member = members.find((m) => m.id === id);
    patchTask(taskId, { assignee: id ? { id, name: member?.name ?? null } : null });
    try {
      await api.patch(`/api/tasks/${taskId}`, { assigneeId: id });
    } catch {
      void rollback();
    }
  };

  if (tasks.length === 0) return <p className="text-xs text-muted-foreground">{t('activity.noTask')}</p>;

  return (
    <ul className="space-y-1.5">
      {tasks.slice(0, limit).map((task) => (
        <li
          key={task.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs"
        >
          <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1 truncate hover:text-primary">
            {task.location && <span className="text-muted-foreground">{task.location} · </span>}
            <span className="font-medium">{task.name}</span>
          </Link>
          {canManage ? (
            <>
              <PipelineStatusSelect
                projectId={projectId}
                scope="task"
                statusId={task.pipelineStatusId}
                legacyStatus={task.status}
                onChange={(next) => setStatus(task.id, next)}
              />
              <select
                aria-label={t('task.new.assignee')}
                value={task.assignee?.id ?? ''}
                onChange={(e) => assign(task.id, e.target.value)}
                className="rounded border border-input bg-background px-1 py-0.5 text-xs"
              >
                <option value="">{t('activity.unassigned')}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <span className={`rounded px-1.5 py-0.5 text-xs ${TASK_STATUS_COLOR[task.status] ?? ''}`}>
                {TASK_STATUS_LABEL_KEY[task.status] ? t(TASK_STATUS_LABEL_KEY[task.status]) : task.status}
              </span>
              {task.assignee && <span className="text-xs text-muted-foreground">{task.assignee.name}</span>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
