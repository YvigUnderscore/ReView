// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';

/**
 * Création d'une tâche, chemin natif (B2).
 *
 * `POST /api/tasks` existait depuis l'origine et n'a aucune dépendance à ShotGrid, mais
 * aucun écran ne l'appelait : le seul geste de création passait par le site distant. Sur
 * un projet autonome, « Nouvelle version » sur un plan sans tâche ouvrait donc un
 * dialogue vide, sans aucun moyen d'en sortir.
 */

export interface CreateTaskInput {
  name: string;
  /** Clé du département — l'étape du pipe. */
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
