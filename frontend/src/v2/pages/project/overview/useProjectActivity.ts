// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { TASK_STATUS_PRIORITY } from '../../../lib/taskStatus';
import type { TaskWithAssignee } from '../../../types/api';

/**
 * `GET /api/projects/:id/activity` — la réponse que se partagent trois blocs de la vue
 * d'ensemble : l'avancement, les dernières mises à jour et les tâches à traiter.
 *
 * Une seule clé de cache pour les trois : TanStack ne lance qu'une requête, et masquer un
 * bloc n'en coûte ni n'en économise une. Le tri des tâches vit ici plutôt que dans le bloc
 * qui les liste, parce que l'avancement compte les mêmes lignes.
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
  /** Tâches du projet, les plus urgentes d'abord (priorité par statut). */
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
