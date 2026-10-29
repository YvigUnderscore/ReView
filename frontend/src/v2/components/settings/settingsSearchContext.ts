// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext } from 'react';

/**
 * The context that connects the search bar to the settings cards.
 *
 * Kept apart from the provider so that the component module exports only components (hot reload), as `card.variants.ts` is
 * kept apart from `card.tsx`.
 */
export interface SettingsSearchValue {
  query: string;
  setQuery: (value: string) => void;
  /** A card declares itself visible or not: this is what makes it possible to count the answers. */
  report: (id: string, visible: boolean) => void;
  /** Number of cards currently displayed. */
  visible: number;
}

/**
 * Outside a provider, there is no search: the card always displays and counts for nothing. This is what allows a
 * `SettingsCard` to be placed in a dialog or an isolated panel without dragging all the machinery along.
 */
export const INERT_SEARCH: SettingsSearchValue = {
  query: '',
  setQuery: () => {},
  report: () => {},
  visible: 0,
};

export const SettingsSearchContext = createContext<SettingsSearchValue | null>(null);

export const useSettingsSearch = (): SettingsSearchValue => useContext(SettingsSearchContext) ?? INERT_SEARCH;
