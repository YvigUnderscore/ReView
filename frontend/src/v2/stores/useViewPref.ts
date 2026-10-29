// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Display preference of lists: cards or compact.
 *
 * Two levels, and that is the whole point:
 *
 *  - an **account setting**, which applies to all lists — someone who prefers dense rows prefers
 *    them everywhere;
 *  - a **per-page override** (`shots:12`, `assets:12`, `sequence-shots:12`…), set only when one
 *    explicitly toggles that particular list. A grid of shots is read as thumbnails, a list of
 *    tasks as rows: the global preference cannot answer for both.
 *
 * Without an override, the list follows the account: that is what "by default, we keep the global
 * setting" means. The store keeps a local mirror (localStorage) so that the display is right on the
 * first render, before the account preferences are loaded — but the account remains the source of
 * truth, and it is what follows the user from one workstation to another.
 */
export type ViewMode = 'cards' | 'compact';

const STORAGE_PREFIX = 'review:view:';
const GLOBAL_KEY = 'review:view:__global';

/** The fallback of the fallback: with nothing remembered anywhere, thumbnails are shown. */
const FALLBACK: ViewMode = 'cards';

const parse = (raw: string | null): ViewMode | null =>
  raw === 'compact' ? 'compact' : raw === 'cards' ? 'cards' : null;

const readLocal = (key: string): ViewMode | null => parse(localStorage.getItem(STORAGE_PREFIX + key));
const readGlobalLocal = (): ViewMode | null => parse(localStorage.getItem(GLOBAL_KEY));

interface ViewPrefState {
  /** Overrides per list, as the account carries them (hydrated on load). */
  modes: Record<string, ViewMode>;
  /** Account setting, applied to every list without an override. */
  global: ViewMode | null;
  /** What the store will send to the server — set by `useViewSync`. */
  persist: ((patch: { viewMode?: ViewMode; viewModes?: Record<string, ViewMode> }) => void) | null;
  get: (key: string) => ViewMode;
  set: (key: string, mode: ViewMode) => void;
  /** Removes the override: the list returns to the account setting. */
  clear: (key: string) => void;
  setGlobal: (mode: ViewMode) => void;
  toggle: (key: string) => void;
  /** Takes over the account state when the preferences load. */
  hydrate: (prefs: { viewMode?: ViewMode; viewModes?: Record<string, ViewMode> }) => void;
  setPersist: (fn: ViewPrefState['persist']) => void;
}

export const useViewPref = create<ViewPrefState>((set, store) => ({
  modes: {},
  global: null,
  persist: null,

  get: (key) => store().modes[key] ?? readLocal(key) ?? store().global ?? readGlobalLocal() ?? FALLBACK,

  set: (key, mode) => {
    localStorage.setItem(STORAGE_PREFIX + key, mode);
    const modes = { ...store().modes, [key]: mode };
    set({ modes });
    store().persist?.({ viewModes: modes });
  },

  clear: (key) => {
    localStorage.removeItem(STORAGE_PREFIX + key);
    const modes = { ...store().modes };
    delete modes[key];
    set({ modes });
    store().persist?.({ viewModes: modes });
  },

  setGlobal: (mode) => {
    localStorage.setItem(GLOBAL_KEY, mode);
    set({ global: mode });
    store().persist?.({ viewMode: mode });
  },

  toggle: (key) => {
    store().set(key, store().get(key) === 'cards' ? 'compact' : 'cards');
  },

  hydrate: (prefs) => {
    // The account wins over the local mirror: it is what followed the user.
    set({ global: prefs.viewMode ?? null, modes: { ...(prefs.viewModes ?? {}) } });
    if (prefs.viewMode) localStorage.setItem(GLOBAL_KEY, prefs.viewMode);
  },

  setPersist: (fn) => set({ persist: fn }),
}));

/**
 * Utility hook: the current view of a list, override included.
 *
 * It subscribes to both levels — without reading `global`, toggling the account setting refreshed
 * no list until the user changed page.
 */
export function useViewMode(contextKey: string): ViewMode {
  return useViewPref(
    (s) => s.modes[contextKey] ?? readLocal(contextKey) ?? s.global ?? readGlobalLocal() ?? FALLBACK,
  );
}

/** Does this list have its own setting, or does it follow the account? */
export function useHasOverride(contextKey: string): boolean {
  return useViewPref((s) => s.modes[contextKey] !== undefined || readLocal(contextKey) !== null);
}
