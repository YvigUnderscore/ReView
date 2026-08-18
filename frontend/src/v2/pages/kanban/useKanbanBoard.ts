// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useSequencesQuery } from '../../lib/queries';
import { useDepartments } from '../../lib/departmentsApi';
import { usePipelineStatuses } from '../../lib/shotgridApi';
import type { TaskStatus } from '../../types/api';
import type { BoardTask, BoardResponse } from './kanbanTypes';
import { useT } from '../../i18n';

/**
 * Données du board (C4) : une seule requête de tâches pour tout le projet.
 *
 * Le board en envoyait une par plan **et** une par asset — cent cinquante appels HTTP à
 * l'ouverture d'un projet moyen, jusqu'à se faire limiter par le serveur. Sur le
 * long-métrage visé, deux mille plans, l'écran ne s'ouvrait tout simplement pas.
 *
 * Le déplacement d'une carte envoie l'identifiant du statut du référentiel quand la
 * colonne en a un : c'est ce qui distingue « On Hold » de « Waiting to Start », que
 * l'énumération à six valeurs confondait.
 */
export function useKanbanBoard(projectId: number) {
  const tr = useT();
  const qc = useQueryClient();
  const sequencesQ = useSequencesQuery(projectId);
  const departmentsQ = useDepartments(projectId, projectId > 0);
  const statusesQ = usePipelineStatuses('task', projectId);

  const boardQ = useQuery({
    queryKey: qk.projectBoard(projectId),
    queryFn: () => api.get<BoardResponse>(`/api/tasks/board?projectId=${projectId}`),
    enabled: projectId > 0,
  });

  const tasks: BoardTask[] = boardQ.data?.items ?? [];

  /**
   * Déplacement optimiste, rollback par invalidation. Le cache est celui du board entier :
   * la carte change de colonne à l'instant du lâcher, sans attendre le serveur.
   */
  const move = async (taskId: number, column: { statusId: number | null; legacyStatus: TaskStatus }) => {
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;
    if (task.pipelineStatusId === column.statusId && task.status === column.legacyStatus) return;
    const key = qk.projectBoard(projectId);
    qc.setQueryData<BoardResponse>(key, (old) =>
      old
        ? {
            ...old,
            items: old.items.map((x) =>
              x.id === taskId ? { ...x, status: column.legacyStatus, pipelineStatusId: column.statusId } : x,
            ),
          }
        : old,
    );
    try {
      await api.patch(
        `/api/tasks/${taskId}`,
        column.statusId !== null ? { pipelineStatusId: column.statusId } : { status: column.legacyStatus },
      );
    } catch (e) {
      // Rollback : l'invalidation relance la requête, inutile de l'attendre.
      void qc.invalidateQueries({ queryKey: key });
      toast.error(e instanceof Error ? e.message : tr('kanban.moveFailed'));
    }
  };

  return {
    tasks,
    total: boardQ.data?.total ?? 0,
    truncated: boardQ.data?.truncated ?? false,
    sequences: sequencesQ.data?.sequences ?? [],
    departments: departmentsQ.data ?? [],
    statuses: statusesQ.data ?? [],
    isLoading: boardQ.isLoading,
    loadError: boardQ.error?.message ?? null,
    move,
  };
}
