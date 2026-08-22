// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useSequencesQuery } from '../../lib/queries';
import { useDepartments } from '../../lib/departmentsApi';
import { usePipelineStatuses } from '../../lib/shotgridApi';
import type { TaskStatus } from '../../types/api';
import { withStatus, type StatusChoice } from '../../lib/statusMenu';
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
/** Le board vide garde le même tableau : sinon chaque rendu re-calculerait tout l'écran. */
const NO_TASKS: BoardTask[] = [];

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

  const tasks: BoardTask[] = boardQ.data?.items ?? NO_TASKS;

  /**
   * Pose un statut dans le cache du board et rend de quoi revenir en arrière.
   *
   * Le menu contextuel et le glisser-déposer partagent cette écriture : sans elle, la
   * carte changée au clic droit resterait dans son ancienne colonne jusqu'au retour du
   * serveur, alors que la même carte déplacée à la souris bouge tout de suite.
   *
   * Identité stable (le client de requêtes et le projet ne bougent pas de la vie de
   * l'écran) : le menu des cartes s'y accroche, et les cartes sont mémoïsées.
   */
  const applyOptimisticStatus = useCallback(
    (taskId: number, choice: StatusChoice | null) => {
      const key = qk.projectBoard(projectId);
      const previous = qc.getQueryData<BoardResponse>(key);
      qc.setQueryData<BoardResponse>(key, (old) =>
        old ? { ...old, items: withStatus(old.items, taskId, choice) } : old,
      );
      return () => {
        if (previous) qc.setQueryData(key, previous);
      };
    },
    [qc, projectId],
  );

  /**
   * Déplacement optimiste, rollback par invalidation. Le cache est celui du board entier :
   * la carte change de colonne à l'instant du lâcher, sans attendre le serveur.
   */
  const move = useCallback(
    async (taskId: number, column: { statusId: number | null; legacyStatus: TaskStatus }) => {
      const task = tasks.find((x) => x.id === taskId);
      if (!task) return;
      if (task.pipelineStatusId === column.statusId && task.status === column.legacyStatus) return;
      const key = qk.projectBoard(projectId);
      qc.setQueryData<BoardResponse>(key, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((x) =>
                x.id === taskId
                  ? { ...x, status: column.legacyStatus, pipelineStatusId: column.statusId }
                  : x,
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
    },
    [tasks, qc, projectId, tr],
  );

  return {
    applyOptimisticStatus,
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
