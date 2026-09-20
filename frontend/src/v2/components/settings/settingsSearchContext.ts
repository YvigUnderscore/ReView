// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext } from 'react';

/**
 * Le contexte qui relie la barre de recherche aux cartes de réglages.
 *
 * Séparé du fournisseur pour que le module de composants n'exporte que des composants
 * (rafraîchissement à chaud), comme `card.variants.ts` l'est de `card.tsx`.
 */
export interface SettingsSearchValue {
  query: string;
  setQuery: (value: string) => void;
  /** Une carte se déclare visible ou non ; c'est ce qui permet de compter les réponses. */
  report: (id: string, visible: boolean) => void;
  /** Nombre de cartes actuellement affichées. */
  visible: number;
}

/**
 * Hors fournisseur, la recherche n'existe pas : la carte s'affiche toujours et ne compte
 * rien. C'est ce qui permet de poser une `SettingsCard` dans un dialogue ou un panneau
 * isolé sans traîner tout l'appareillage.
 */
export const INERT_SEARCH: SettingsSearchValue = {
  query: '',
  setQuery: () => {},
  report: () => {},
  visible: 0,
};

export const SettingsSearchContext = createContext<SettingsSearchValue | null>(null);

export const useSettingsSearch = (): SettingsSearchValue => useContext(SettingsSearchContext) ?? INERT_SEARCH;
