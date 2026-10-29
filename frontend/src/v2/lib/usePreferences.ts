// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import type { UserPreferences } from '../types/api';

/**
 * Shared base of the per-account UI preferences (42.A): centralises access to
 * `GET/PATCH /api/users/me/preferences` (until now duplicated inline in several pages).
 */
export function usePreferences() {
  return useQuery({
    queryKey: qk.preferences,
    queryFn: () =>
      api.get<{ preferences: UserPreferences }>('/api/users/me/preferences').then((d) => d.preferences),
  });
}

/**
 * Updates the preferences (shallow merge on the backend side). The cache is refreshed with
 * the value returned by the server — the source of truth remains the backend.
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
