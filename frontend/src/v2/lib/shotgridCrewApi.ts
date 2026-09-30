// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { sgKeys } from './shotgridApi';
import type { SgCrewInviteResult, SgCrewResponse } from '../types/shotgrid';

/**
 * L'équipe du projet ShotGrid.
 *
 * La requête touche le site distant : elle n'est lancée que sur demande explicite
 * (`enabled`), pas à l'ouverture de l'onglet Membres.
 */
export function useSgCrew(projectId: number, enabled: boolean) {
  return useQuery({
    queryKey: sgKeys.crew(projectId),
    queryFn: () => api.get<SgCrewResponse>(`/api/shotgrid/projects/${projectId}/crew`),
    enabled: enabled && projectId > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Relie à la main un compte du site à un compte ReView (ou défait le lien).
 *
 * Le rapprochement automatique passe par l'adresse ; celui-ci sert aux personnes dont
 * l'adresse diffère d'un outil à l'autre, et que rien ne pouvait donc relier.
 */
export function useLinkSgAccount(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sgId, userId }: { sgId: number; userId: number | null }) =>
      api.put(`/api/shotgrid/projects/${projectId}/crew/${sgId}/link`, { userId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sgKeys.crew(projectId) });
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
    },
  });
}

export function useInviteSgCrew(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sgIds: number[]) =>
      api
        .post<{ results: SgCrewInviteResult[] }>(`/api/shotgrid/projects/${projectId}/crew/invite`, {
          sgIds,
        })
        .then((r) => r.results),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sgKeys.crew(projectId) });
      // La liste des membres du projet et l'annuaire changent tous les deux.
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
      void qc.invalidateQueries({ queryKey: qk.users });
    },
  });
}
