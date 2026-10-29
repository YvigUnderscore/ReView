// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';

/**
 * Creating a task, native path (B2).
 *
 * `POST /api/tasks` has existed since the start and has no dependency on ShotGrid, but
 * no screen called it: the only creation gesture went through the remote site. On
 * a standalone project, "New version" on a shot with no task therefore opened an
 * empty dialog, with no way out.
 */

export interface CreateTaskInput {
  name: string;
  /** Department key — the step of the pipe. */
  department?: string | null;
  shotId?: number;
  assetId?: number;
  assigneeId?: number | null;
}

export interface CreatedTask {
  id: number;
  name: string;
  department: string | null;
}

export function useCreateTask(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.post<{ task: CreatedTask }>('/api/tasks', input),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: qk.projectTasks(projectId) });
      if (input.shotId) {
        void qc.invalidateQueries({ queryKey: qk.shotTree(input.shotId) });
        void qc.invalidateQueries({ queryKey: qk.tasks(input.shotId) });
      }
      if (input.assetId) void qc.invalidateQueries({ queryKey: qk.assetTree(input.assetId) });
    },
  });
}
