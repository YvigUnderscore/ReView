import { create } from 'zustand';

/**
 * Densité d'affichage (42.A1 — №74). `comfortable` (défaut) ou `compact`.
 * Applique l'attribut `data-density` sur <html> dès l'import (avant le premier rendu) ;
 * le CSS (index.css) réduit l'échelle de l'UI en mode compact via la taille de police racine.
 */
export type Density = 'comfortable' | 'compact';

const STORAGE_KEY = 'review:density';

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
