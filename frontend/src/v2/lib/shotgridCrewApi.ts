// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { sgKeys } from './shotgridApi';
import type { SgCrewInviteResult, SgCrewResponse } from '../types/shotgrid';

/**
 * The ShotGrid project crew.
 *
 * The query hits the remote site: it only runs on explicit request (`enabled`), not when the Members
 * tab is opened.
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
 * Manually links a site account to a ReView account (or unlinks it).
 *
 * Automatic matching goes through the email address; this one serves people whose address differs
 * between tools, and that nothing could therefore link.
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
      // The project's member list and the directory both change.
      void qc.invalidateQueries({ queryKey: qk.project(projectId) });
      void qc.invalidateQueries({ queryKey: qk.users });
    },
  });
}
