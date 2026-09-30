// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';

/**
 * Règles de masquage (admin).
 *
 * Une écriture invalide **tout** ce qui liste des entités : masquer, c'est retirer des
 * plans de l'onglet Plans, du cut, de la recherche et des statistiques d'un seul geste.
 * Cibler les invalidations reviendrait à énumérer les écrans, donc à en oublier.
 */

export type MatchType = 'exact' | 'prefix' | 'contains' | 'regex';
export type VisibilityEntityType = 'all' | 'episode' | 'sequence' | 'shot' | 'asset';

export interface VisibilityRule {
  id: number;
  projectId: number | null;
  entityType: VisibilityEntityType;
  matchType: MatchType;
  pattern: string;
  ignoreCase: boolean;
  reason: string | null;
  enabled: boolean;
  createdAt: string;
}

/** Ce qu'un recalcul a fait : de quoi le dire à l'admin plutôt que de le laisser deviner. */
export interface ApplyResult {
  hidden: number;
  revealed: number;
}

export interface RuleInput {
  projectId?: number | null;
  entityType: VisibilityEntityType;
  matchType: MatchType;
  pattern: string;
  ignoreCase?: boolean;
  reason?: string | null;
  enabled?: boolean;
}

const KEY = ['visibility', 'rules'] as const;

export function useVisibilityRules(projectId?: number) {
  return useQuery({
    queryKey: [...KEY, projectId ?? null],
    queryFn: () =>
      api
        .get<{ rules: VisibilityRule[] }>(
          `/api/visibility/rules${projectId ? `?projectId=${projectId}` : ''}`,
        )
        .then((r) => r.rules),
  });
}

/** Invalide tout ce qui affiche des entités — cf. l'entête de ce module. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: KEY });
    for (const key of ['shots', 'sequences', 'assets', 'episodes', 'timeline', 'production']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function useCreateRule() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: RuleInput) =>
      api.post<{ rule: VisibilityRule; applied: ApplyResult }>('/api/visibility/rules', input),
    onSuccess: refresh,
  });
}

export function useUpdateRule() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<RuleInput> & { id: number }) =>
      api.patch<{ rule: VisibilityRule; applied: ApplyResult }>(`/api/visibility/rules/${id}`, input),
    onSuccess: refresh,
  });
}

export function useDeleteRule() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: number) => api.del<{ applied: ApplyResult }>(`/api/visibility/rules/${id}`),
    onSuccess: refresh,
  });
}

/** Rejoue les règles à la demande — elles le sont déjà à chaque écriture et à chaque import. */
export function useApplyRules() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (projectId?: number) =>
      api.post<{ applied: ApplyResult }>('/api/visibility/apply', projectId ? { projectId } : {}),
    onSuccess: refresh,
  });
}
