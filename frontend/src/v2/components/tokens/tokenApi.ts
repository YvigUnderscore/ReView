// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';

/**
 * Access to the machine rights model: scope catalogue and token shapes.
 *
 * The catalogue comes from the server (`GET /api/auth/scopes`) and is never copied to the
 * front end: that is what guarantees a scope removed from the catalogue disappears from the screens.
 */

/** Cache key for the scope catalogue: static, shared between profile and admin. */
export const scopeCatalogKey = ['api-scopes'] as const;

/** Cache key for the studio's service tokens. */
export const serviceTokensKey = ['admin', 'service-tokens'] as const;

export interface ScopeCatalog {
  /** Fine-grained assignable scopes, `domain:action` (+ `admin`). */
  scopes: string[];
  /** Legacy scopes (`read`, `write`): still accepted, no longer offered. */
  legacy: string[];
}

/** Token as the server returns it: never the secret, which only exists at issuance. */
export interface TokenRow {
  id: number;
  name: string;
  description: string | null;
  scopes: string[];
  projectId: number | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Service token: its owning account gives the effective role, its project the scope. */
export type ServiceTokenRow = TokenRow & {
  user: { id: number; email: string; role: string };
  project: { id: number; name: string } | null;
};

/**
 * Scope catalogue. `staleTime: Infinity`: it only changes with the server version, so
 * reloading it every time a form opens would teach nothing.
 */
export function useScopeCatalog() {
  return useQuery({
    queryKey: scopeCatalogKey,
    queryFn: () => api.get<ScopeCatalog>('/api/auth/scopes'),
    staleTime: Infinity,
  });
}
