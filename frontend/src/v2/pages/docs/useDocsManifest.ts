// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { qk } from '../../lib/query';
import { t } from '../../i18n';
import type { DocsManifest } from './docsManifest';

/**
 * Sommaire de la documentation, partagé par la page `/docs` et la palette Ctrl+K.
 *
 * Le manifest est un fichier statique produit au build (`scripts/build-docs.mjs`) et servi
 * par le frontend : il ne passe pas par l'API, ne dépend d'aucune session, et ne change
 * jamais pendant la vie de l'onglet — d'où `staleTime: Infinity` et une clé unique, pour
 * que la palette réutilise ce que la page de documentation a déjà chargé (et réciproquement).
 *
 * `enabled` existe pour la palette : elle ne doit pas aller chercher soixante-dix titres de
 * page tant que personne n'a rien tapé.
 */
export function useDocsManifest(enabled = true) {
  return useQuery({
    queryKey: qk.docsManifest(),
    queryFn: async (): Promise<DocsManifest> => {
      const res = await fetch('/docs/manifest.json');
      if (!res.ok) throw new Error(t('docs.unavailable', { status: res.status }));
      return (await res.json()) as DocsManifest;
    },
    staleTime: Infinity,
    enabled,
  });
}
