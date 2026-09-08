// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useAuth } from '../../stores/useAuth';
import { useDocsManifest } from '../../pages/docs/useDocsManifest';
import { useT } from '../../i18n';
import { searchDocSurfaces, searchSettingsSurfaces, type SurfaceHit } from './surfaceSearch';

/**
 * Les deux familles de résultats que le serveur ne connaît pas : les pages de documentation
 * et les écrans de réglages (cf. `surfaceSearch`, où vit toute la logique).
 *
 * Dans un module à part du composant : la palette a besoin de savoir **s'il y a quelque
 * chose à afficher** avant de rendre son message « aucun résultat », et un fichier qui
 * exporte à la fois un composant et un hook casse le rafraîchissement à chaud de Vite.
 *
 * Aucune mémoïsation : le calcul porte sur soixante-dix titres de page en mémoire, et un
 * `useMemo` dont les dépendances ne bougent pas au changement de langue rendrait des
 * libellés périmés — le seul cas où il coûterait quelque chose.
 */
export interface SurfaceHits {
  docs: SurfaceHit[];
  settings: SurfaceHit[];
}

export const hasSurfaceHits = (hits: SurfaceHits): boolean =>
  hits.docs.length > 0 || hits.settings.length > 0;

export function useSurfaceSearch(query: string, enabled: boolean): SurfaceHits {
  const t = useT();
  const role = useAuth((s) => s.user?.role);
  // Le sommaire n'est chargé qu'à la première recherche, et partagé avec la page /docs.
  const manifest = useDocsManifest(enabled);

  if (!enabled) return { docs: [], settings: [] };
  return {
    docs: searchDocSurfaces(manifest.data?.sections ?? [], query, t),
    settings: searchSettingsSurfaces(query, role, t),
  };
}
