// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Display density (42.A1 — №74). `comfortable` (default) or `compact`.
 * Applies the `data-density` attribute on <html> as soon as the module is imported (before the
 * first render); the CSS (index.css) shrinks the UI scale in compact mode via the root font size.
 *
 * Since A2 the choice also follows the account: a new workstation picks up the density stored
 * server-side, but an explicit choice made on this device takes precedence — same rule as the
 * language (`syncAccountLocale`).
 */
export type Density = 'comfortable' | 'compact';

const STORAGE_KEY = 'review:density';

export function isDensity(value: unknown): value is Density {
  return value === 'comfortable' || value === 'compact';
}

function applyDensity(density: Density) {
  document.documentElement.setAttribute('data-density', density);
}

function readInitial(): Density {
  return localStorage.getItem(STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
}

const initial = readInitial();
applyDensity(initial);

export const useDensity = create<{ density: Density; setDensity: (d: Density) => void }>((set) => ({
  density: initial,
  setDensity: (density) => {
    localStorage.setItem(STORAGE_KEY, density);
    applyDensity(density);
    set({ density });
  },
}));

/** Applies the account's density as long as this device has not made an explicit choice. */
export function syncAccountDensity(density: unknown): void {
  if (!isDensity(density) || localStorage.getItem(STORAGE_KEY) !== null) return;
  applyDensity(density);
  useDensity.setState({ density });
}
