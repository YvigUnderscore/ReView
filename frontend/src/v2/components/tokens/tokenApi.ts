// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';

/**
 * Accès au modèle de droits machine : catalogue de scopes et formes des tokens.
 *
 * Le catalogue vient du serveur (`GET /api/auth/scopes`) et n'est jamais recopié côté
 * front : c'est ce qui garantit qu'un scope retiré du catalogue disparaît des écrans.
 */

/** Clé de cache du catalogue de scopes — statique, partagée profil ↔ administration. */
export const scopeCatalogKey = ['api-scopes'] as const;

/** Clé de cache des tokens de service du studio. */
export const serviceTokensKey = ['admin', 'service-tokens'] as const;

export interface ScopeCatalog {
  /** Scopes fins attribuables, `domaine:action` (+ `admin`). */
  scopes: string[];
  /** Scopes hérités (`read`, `write`) — encore acceptés, plus jamais proposés. */
  legacy: string[];
}

/** Token tel que le serveur le rend — jamais le secret, qui n'existe qu'à l'émission. */
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

/** Token de service : son compte porteur donne le rôle effectif, son projet la portée. */
export type ServiceTokenRow = TokenRow & {
  user: { id: number; email: string; role: string };
  project: { id: number; name: string } | null;
};

/**
 * Catalogue de scopes. `staleTime: Infinity` : il ne change qu'avec la version du serveur,
 * le recharger à chaque ouverture de formulaire n'apprendrait rien.
 */
export function useScopeCatalog() {
  return useQuery({
    queryKey: scopeCatalogKey,
    queryFn: () => api.get<ScopeCatalog>('/api/auth/scopes'),
    staleTime: Infinity,
  });
}
