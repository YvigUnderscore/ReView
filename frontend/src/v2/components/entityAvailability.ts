// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApiError } from '../../lib/apiClient';

/**
 * Les deux questions que se pose une page d'entité avant de se rendre : « mon sujet
 * existe-t-il ? » et « l'identifiant de l'URL veut-il seulement dire quelque chose ? ».
 *
 * Dans leur propre fichier plutôt qu'à côté du composant : un module qui exporte à la fois
 * un composant et des fonctions casse le rafraîchissement à chaud de Vite.
 */

/** L'erreur dit-elle que l'entité est absente (404) ou fermée (403) ? */
export function isMissingOrForbidden(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

/** Un identifiant d'URL inexploitable (`/tasks/abc`) vaut une entité absente. */
export function isBadId(id: number): boolean {
  return !Number.isFinite(id) || id <= 0;
}
