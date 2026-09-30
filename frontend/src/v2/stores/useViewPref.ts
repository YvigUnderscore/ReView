// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';

/**
 * Préférence d'affichage des listes : cartes ou compact.
 *
 * Deux niveaux, et c'est tout l'intérêt :
 *
 *  - un **réglage de compte**, qui vaut pour toutes les listes — quelqu'un qui préfère les
 *    lignes denses les préfère partout ;
 *  - un **écart par page** (`shots:12`, `assets:12`, `sequence-shots:12`…), posé
 *    seulement quand on bascule explicitement sur cette liste-là. Une grille de plans se
 *    lit en vignettes, une liste de tâches en lignes : la préférence globale ne peut pas
 *    répondre pour les deux.
 *
 * Sans écart, la liste suit le compte : c'est ce que « de base, on conserve le réglage
 * global » veut dire. Le store garde le miroir local (localStorage) pour que l'affichage
 * soit juste au premier rendu, avant que les préférences du compte ne soient chargées —
 * mais le compte reste la source de vérité, et c'est lui qui suit d'un poste à l'autre.
 */
export type ViewMode = 'cards' | 'compact';

const STORAGE_PREFIX = 'review:view:';
const GLOBAL_KEY = 'review:view:__global';

/** Le repli du repli : sans rien de mémorisé nulle part, on montre des vignettes. */
const FALLBACK: ViewMode = 'cards';

const parse = (raw: string | null): ViewMode | null =>
  raw === 'compact' ? 'compact' : raw === 'cards' ? 'cards' : null;

const readLocal = (key: string): ViewMode | null => parse(localStorage.getItem(STORAGE_PREFIX + key));
const readGlobalLocal = (): ViewMode | null => parse(localStorage.getItem(GLOBAL_KEY));

interface ViewPrefState {
  /** Écarts par liste, tels que le compte les porte (hydratés au chargement). */
  modes: Record<string, ViewMode>;
  /** Réglage de compte, appliqué à toute liste sans écart. */
  global: ViewMode | null;
  /** Ce que le store enverra au serveur — posé par `useViewSync`. */
  persist: ((patch: { viewMode?: ViewMode; viewModes?: Record<string, ViewMode> }) => void) | null;
  get: (key: string) => ViewMode;
  set: (key: string, mode: ViewMode) => void;
  /** Retire l'écart : la liste retourne au réglage du compte. */
  clear: (key: string) => void;
  setGlobal: (mode: ViewMode) => void;
  toggle: (key: string) => void;
  /** Reprend l'état du compte au chargement des préférences. */
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
    // Le compte gagne sur le miroir local : c'est lui qui a suivi l'utilisateur.
    set({ global: prefs.viewMode ?? null, modes: { ...(prefs.viewModes ?? {}) } });
    if (prefs.viewMode) localStorage.setItem(GLOBAL_KEY, prefs.viewMode);
  },

  setPersist: (fn) => set({ persist: fn }),
}));

/**
 * Hook utilitaire : la vue courante d'une liste, écart compris.
 *
 * Il s'abonne aux deux niveaux — sans lire `global`, basculer le réglage de compte ne
 * rafraîchissait aucune liste tant qu'on ne changeait pas de page.
 */
export function useViewMode(contextKey: string): ViewMode {
  return useViewPref(
    (s) => s.modes[contextKey] ?? readLocal(contextKey) ?? s.global ?? readGlobalLocal() ?? FALLBACK,
  );
}

/** Cette liste a-t-elle son propre réglage, ou suit-elle le compte ? */
export function useHasOverride(contextKey: string): boolean {
  return useViewPref((s) => s.modes[contextKey] !== undefined || readLocal(contextKey) !== null);
}
