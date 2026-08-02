// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Thème de l'interface (42.A1 — étend le socle clair/sombre).
 * - `mode` = choix de l'utilisateur : `dark` | `light` | `system` (suit l'OS).
 * - `theme` = thème **effectif** appliqué (`dark`|`light`), dérivé de `mode`.
 * La classe `dark` est posée sur <html> dès l'import du module (avant le premier rendu)
 * pour éviter un flash au chargement. En mode `system`, on écoute `prefers-color-scheme`
 * et on réapplique le thème effectif à chaque changement de l'OS.
 */
export type Theme = 'dark' | 'light';
export type ThemeMode = Theme | 'system';

const STORAGE_KEY = 'review:theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true; // défaut studio = sombre
}

function effective(mode: ThemeMode): Theme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function readMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Valeurs héritées `dark`/`light` restent des modes valides (migration transparente).
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'dark';
}

const initialMode = readMode();
applyTheme(effective(initialMode));

export const useTheme = create<{
  mode: ThemeMode;
  theme: Theme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}>((set, get) => {
  // En mode `system`, réagir aux changements de préférence de l'OS.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (get().mode !== 'system') return;
      const next = effective('system');
      applyTheme(next);
      set({ theme: next });
    };
    mq.addEventListener?.('change', onChange);
  }

  const setMode = (mode: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    const theme = effective(mode);
    applyTheme(theme);
    set({ mode, theme });
  };

  return {
    mode: initialMode,
    theme: effective(initialMode),
    setMode,
    // Bascule rapide (bouton sidebar) : inverse le thème **effectif** en le figeant explicitement.
    toggle: () => setMode(get().theme === 'dark' ? 'light' : 'dark'),
  };
});
