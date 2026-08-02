// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Préférence d'affichage des listes (cartes vs compact), mémorisée par contexte
 * (« projects », « assets », « shots »…) dans localStorage. Persiste par navigateur.
 */
export type ViewMode = 'cards' | 'compact';

const STORAGE_PREFIX = 'review:view:';

const read = (key: string): ViewMode => {
  const v = localStorage.getItem(STORAGE_PREFIX + key);
  return v === 'compact' ? 'compact' : 'cards';
};

interface ViewPrefState {
  modes: Record<string, ViewMode>;
  get: (key: string) => ViewMode;
  set: (key: string, mode: ViewMode) => void;
  toggle: (key: string) => void;
}

export const useViewPref = create<ViewPrefState>((set, store) => ({
  modes: {},
  get: (key) => store().modes[key] ?? read(key),
  set: (key, mode) => {
    localStorage.setItem(STORAGE_PREFIX + key, mode);
    set((s) => ({ modes: { ...s.modes, [key]: mode } }));
  },
  toggle: (key) => {
    const next: ViewMode = store().get(key) === 'cards' ? 'compact' : 'cards';
    store().set(key, next);
  },
}));

/** Hook utilitaire : lit la préférence courante pour un contexte. */
export function useViewMode(contextKey: string): ViewMode {
  return useViewPref((s) => s.modes[contextKey] ?? read(contextKey));
}
