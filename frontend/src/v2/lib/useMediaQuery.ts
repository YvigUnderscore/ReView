// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from 'react';

/** A single MediaQueryList per query: otherwise each caller opens its own subscription. */
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
 * Subscribes to a media query, without effect or intermediate render (useSyncExternalStore).
 * Returns `false` on the server render / before hydration.
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
 * Narrow-window threshold (A1): browser in half-screen next to a 3D application.
 * Below it, the sidebar folds itself away — 240 px of rail on a 1000 px
 * window leave no room to read a list.
 */
export const NARROW_WIDTH_QUERY = '(max-width: 1100px)';

export function useIsNarrowViewport(): boolean {
  return useMediaQuery(NARROW_WIDTH_QUERY);
}
