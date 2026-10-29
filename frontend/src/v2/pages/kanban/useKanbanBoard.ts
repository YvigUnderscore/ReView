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
import { useUndoToast } from '../../lib/useUndoToast';
import type { BoardTask, BoardResponse } from './kanbanTypes';
import { useT } from '../../i18n';

/**
 * Board data (C4): a single task request for the whole project.
 *
 * The board used to send one request per shot **and** one per asset: a hundred and fifty HTTP
 * calls when opening an average project, to the point of being rate-limited by the server. On the
 * targeted feature film (two thousand shots), the screen simply would not open.
 *
 * Moving a card sends the reference-data status identifier when the column has one: this is what
 * distinguishes "On Hold" from "Waiting to Start", which the six-value enumeration conflated.
 */
/** The empty board keeps the same array: otherwise every render would recompute the whole screen. */
const NO_TASKS: BoardTask[] = [];

/** Column of a card, as `move` expects it: enough to put it back where it came from. */
type MoveTarget = { statusId: number | null; legacyStatus: TaskStatus };

export function useKanbanBoard(projectId: number) {
  const tr = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();
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
   * Sets a status in the board cache and returns what is needed to go back.
   *
   * The context menu and drag-and-drop share this write: without it, a card changed by right-click
   * would stay in its old column until the server replies, whereas the same card moved with the
   * mouse moves immediately.
   *
   * Stable identity (the query client and the project do not change during the life of the
   * screen): the card menu hooks onto it, and the cards are memoized.
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
   * The bare write of the move: optimistic, and it **lets its failure propagate**.
   *
   * Separated from `move` because the undo replays it towards the original column, and a failure
   * of the undo must reach the toast that offered it.
   */
  const writeMove = useCallback(
    async (taskId: number, column: MoveTarget) => {
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
        // Rollback: the invalidation re-runs the query, so there is no need to wait for it.
        void qc.invalidateQueries({ queryKey: key });
        throw e;
      }
    },
    [qc, projectId],
  );

  /**
   * Optimistic move, with rollback by invalidation. The cache is that of the whole board: the card
   * changes column the instant it is dropped, without waiting for the server.
   *
   * The drop is confirmed, with "Undo": a card dropped in the wrong column of a fifteen-column
   * board could only be recovered by searching by hand for where it came from, and nothing said
   * so, since success was silent. The reverse is held exactly: the starting column is known, and
   * putting it back is the same `PATCH`. It is not a Ctrl+Z for all that: the write has gone out to
   * others, and ShotGrid may have arbitrated behind it.
   */
  const move = useCallback(
    async (taskId: number, column: MoveTarget) => {
      const task = tasks.find((x) => x.id === taskId);
      if (!task) return;
      if (task.pipelineStatusId === column.statusId && task.status === column.legacyStatus) return;
      const from: MoveTarget = { statusId: task.pipelineStatusId, legacyStatus: task.status };
      try {
        await writeMove(taskId, column);
        done(tr('kanban.moved'), () => writeMove(taskId, from));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : tr('kanban.moveFailed'));
      }
    },
    [tasks, tr, done, writeMove],
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
