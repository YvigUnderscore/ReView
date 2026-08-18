// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Densité d'affichage (42.A1 — №74). `comfortable` (défaut) ou `compact`.
 * Applique l'attribut `data-density` sur <html> dès l'import (avant le premier rendu) ;
 * le CSS (index.css) réduit l'échelle de l'UI en mode compact via la taille de police racine.
 *
 * Depuis A2 le choix suit aussi le compte : un poste neuf reprend la densité enregistrée
 * côté serveur, mais un choix explicite fait sur cet appareil reste prioritaire — même
 * règle que la langue (`syncAccountLocale`).
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

/** Applique la densité du compte tant que cet appareil n'a pas fait de choix explicite. */
export function syncAccountDensity(density: unknown): void {
  if (!isDensity(density) || localStorage.getItem(STORAGE_KEY) !== null) return;
  applyDensity(density);
  useDensity.setState({ density });
}
