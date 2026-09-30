// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import type { UserPreferences } from '../types/api';

/**
 * Socle partagé des préférences UI par compte (42.A) : centralise l'accès à
 * `GET/PATCH /api/users/me/preferences` (jusqu'ici dupliqué inline dans plusieurs pages).
 */
export function usePreferences() {
  return useQuery({
    queryKey: qk.preferences,
    queryFn: () =>
      api.get<{ preferences: UserPreferences }>('/api/users/me/preferences').then((d) => d.preferences),
  });
}

/**
 * Met à jour les préférences (merge superficiel côté backend). Le cache est rafraîchi avec
 * la valeur renvoyée par le serveur — la source de vérité reste le backend.
 */
export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserPreferences>) =>
      api
        .patch<{ preferences: UserPreferences }>('/api/users/me/preferences', patch)
        .then((d) => d.preferences),
    onSuccess: (prefs) => qc.setQueryData(qk.preferences, prefs),
  });
}
