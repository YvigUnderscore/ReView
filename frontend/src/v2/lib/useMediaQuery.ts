// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from 'react';

/** Une seule MediaQueryList par requête : sinon chaque appelant ouvre son propre abonnement. */
const registry = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList {
  let mql = registry.get(query);
  if (!mql) {
    mql = window.matchMedia(query);
    registry.set(query, mql);
  }
  return mql;
}

/**
 * Abonnement à une media query, sans effet ni rendu intermédiaire (useSyncExternalStore).
 * Renvoie `false` au rendu serveur / avant hydratation.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = listFor(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => listFor(query).matches,
    () => false,
  );
}

/**
 * Seuil de fenêtre étroite (A1) : navigateur en demi-écran à côté d'un logiciel 3D.
 * En dessous, la barre latérale se replie d'elle-même — 240 px de rail sur 1000 px de
 * fenêtre ne laissent pas de quoi lire une liste.
 */
export const NARROW_WIDTH_QUERY = '(max-width: 1100px)';

export function useIsNarrowViewport(): boolean {
  return useMediaQuery(NARROW_WIDTH_QUERY);
}
