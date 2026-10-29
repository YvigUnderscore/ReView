// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { applyAccent } from '../lib/branding';

/**
 * Interface theme (42.A1 — extends the light/dark base).
 * - `mode` = the user's choice: `dark` | `light` | `system` (follows the OS).
 * - `theme` = the **effective** theme applied (`dark`|`light`), derived from `mode`.
 * The `dark` class is set on <html> as soon as the module is imported (before the first render)
 * to avoid a flash at load. In `system` mode, `prefers-color-scheme` is listened to and the
 * effective theme is re-applied on every OS change.
 */
export type Theme = 'dark' | 'light';
export type ThemeMode = Theme | 'system';

const STORAGE_KEY = 'review:theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true; // studio default = dark
}

function effective(mode: ThemeMode): Theme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  // The studio accent is clamped differently per theme (see `readableAccent`): without this
  // re-apply, switching to light kept the vivid dark-theme accent and the focus ring vanished.
  applyAccent(localStorage.getItem('review:accent'));
}

function readMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Legacy `dark`/`light` values remain valid modes (transparent migration).
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
  // In `system` mode, react to OS preference changes.
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
    // Quick toggle (sidebar button): inverts the **effective** theme by pinning it explicitly.
    toggle: () => setMode(get().theme === 'dark' ? 'light' : 'dark'),
  };
});
