// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useAuth } from '../../stores/useAuth';
import { useDocsManifest } from '../../pages/docs/useDocsManifest';
import { useT } from '../../i18n';
import { searchDocSurfaces, searchSettingsSurfaces, type SurfaceHit } from './surfaceSearch';

/**
 * The two families of results the server does not know about: documentation pages and settings screens
 * (see `surfaceSearch`, where all the logic lives).
 *
 * They live in a module separate from the component: the palette must know **whether there is anything to display**
 * before rendering its "no results" message, and a file exporting both a component and a hook breaks Vite's hot reload.
 *
 * No memoisation: the computation runs over seventy page titles held in memory, and a `useMemo` whose dependencies do
 * not change on a language switch would render stale labels, the only case where it would cost anything.
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
  // The table of contents is only loaded on the first search, and shared with the /docs page.
  const manifest = useDocsManifest(enabled);

  if (!enabled) return { docs: [], settings: [] };
  return {
    docs: searchDocSurfaces(manifest.data?.sections ?? [], query, t),
    settings: searchSettingsSurfaces(query, role, t),
  };
}
