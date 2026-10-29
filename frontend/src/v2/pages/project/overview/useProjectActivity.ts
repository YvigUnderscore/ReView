// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { TASK_STATUS_PRIORITY } from '../../../lib/taskStatus';
import type { TaskWithAssignee } from '../../../types/api';

/**
 * `GET /api/projects/:id/activity`: the response shared by three blocks of the overview: progress,
 * latest updates and tasks to handle.
 *
 * A single cache key serves the three: TanStack only launches one request, and hiding a block
 * neither costs one nor saves one. The sorting of tasks lives here rather than in the block that
 * lists them, because progress counts the same rows.
 */

export interface ActivityItem {
  type: 'version' | 'media';
  id: number;
  at: string;
  label: string;
  location: string;
  author: string | null;
  kind?: string;
  taskId?: number | null;
  mediaId?: number;
  versionId?: number;
}

export type ActivityTask = TaskWithAssignee & { location: string; pipelineStatusId?: number | null };

export interface ProjectActivity {
  recent: ActivityItem[];
  tasks: ActivityTask[];
}

export interface ProjectActivityState {
  recent: ActivityItem[];
  /** Project tasks, most urgent first (priority by status). */
  tasks: ActivityTask[];
  error: Error | null;
  isPending: boolean;
}

export function useProjectActivity(projectId: number): ProjectActivityState {
  const { data, error, isPending } = useQuery({
    queryKey: qk.projectActivity(projectId),
    queryFn: () => api.get<ProjectActivity>(`/api/projects/${projectId}/activity`),
  });
  const tasks = useMemo(
    () =>
      [...(data?.tasks ?? [])].sort(
        (a, b) => (TASK_STATUS_PRIORITY[a.status] ?? 9) - (TASK_STATUS_PRIORITY[b.status] ?? 9),
      ),
    [data],
  );
  return { recent: data?.recent ?? [], tasks, error, isPending };
}
