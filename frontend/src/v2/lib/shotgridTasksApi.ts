// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { useSgConnection } from './shotgridApi';

/**
 * Étapes de pipeline et création de tâche.
 *
 * Séparé du reste de l'API ShotGrid parce que ces trois appels servent un seul geste :
 * créer la tâche qui manque pour pouvoir déposer un rendu.
 */

export interface SgPipelineStep {
  sgId: number;
  code: string;
  shortName: string;
  color: string | null;
  order: number;
  /** Une tâche du projet porte-t-elle déjà cette étape ? */
  used: boolean;
}

/**
 * Étapes que le site connaît pour ce type d'entité.
 *
 * Ce sont les colonnes qu'on voit dans ShotGrid — art, model, rig, groom, lookdev — et
 * elles existent avant toute tâche. Demandées seulement quand on en a besoin : la liste
 * vient du site, elle n'a rien à faire dans le chargement d'une page.
 */
export function useSgSteps(projectId: number, entityType: 'Asset' | 'Shot', enabled = true) {
  const { data: connection } = useSgConnection(projectId);
  return useQuery({
    queryKey: ['shotgrid', 'steps', projectId, entityType],
    queryFn: () =>
      api
        .get<{ steps: SgPipelineStep[] }>(
          `/api/shotgrid/projects/${projectId}/steps?entityType=${entityType}`,
        )
        .then((r) => r.steps),
    enabled: enabled && Boolean(connection?.active),
    staleTime: 10 * 60_000,
  });
}

export interface SgProjectMember {
  sgId: number;
  name: string;
  email: string | null;
  userId: number | null;
}

/** Personnes affectées au projet sur le site — pas l'annuaire du studio. */
export function useSgProjectMembers(projectId: number, enabled = true) {
  const { data: connection } = useSgConnection(projectId);
  return useQuery({
    queryKey: ['shotgrid', 'members', projectId],
    queryFn: () =>
      api
        .get<{ members: SgProjectMember[] }>(`/api/shotgrid/projects/${projectId}/members`)
        .then((r) => r.members),
    enabled: enabled && Boolean(connection?.active),
    staleTime: 10 * 60_000,
  });
}

/** Crée dans ShotGrid la tâche qui manque, puis la rapatrie. */
export function useCreateTaskFromStep(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      stepSgId: number;
      parentType: 'asset' | 'shot';
      parentId: number;
      name?: string;
      assigneeSgId?: number | null;
    }) =>
      api.post<{ taskId: number; sgId: number; name: string }>(
        `/api/shotgrid/projects/${projectId}/tasks`,
        body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['asset'] });
      qc.invalidateQueries({ queryKey: ['shotgrid', 'links', projectId] });
      qc.invalidateQueries({ queryKey: ['shotgrid', 'steps', projectId] });
    },
  });
}
