// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { foldForSearch, matchDestinations } from './paletteMatch';

/**
 * The palette offered four destinations, and made them vanish as soon as the first letter was typed: it was impossible to
 * do what a palette is for, typing "kanb" to go to the kanban. Filtering is done here, `Command` being mounted with
 * `shouldFilter={false}`.
 */
const ITEMS = [
  { key: 'kanban', label: 'Kanban' },
  { key: 'admin', label: 'Réglages' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'shots', label: 'Shots' },
];

describe('matchDestinations', () => {
  it('renders everything when nothing is typed', () => {
    expect(matchDestinations(ITEMS, '')).toHaveLength(4);
    expect(matchDestinations(ITEMS, '   ')).toHaveLength(4);
  });

  it('finds a destination on the start of a word', () => {
    expect(matchDestinations(ITEMS, 'kanb').map((i) => i.key)).toEqual(['kanban']);
  });

  it('ignores accents and case', () => {
    expect(matchDestinations(ITEMS, 'reglages').map((i) => i.key)).toEqual(['admin']);
    expect(matchDestinations(ITEMS, 'RÉGLAGES').map((i) => i.key)).toEqual(['admin']);
  });

  it('also accepts the technical key, which is stable from one language to another', () => {
    expect(matchDestinations(ITEMS, 'admin').map((i) => i.key)).toEqual(['admin']);
  });

  it('renders nothing when nothing matches: the "no results" message must be able to appear', () => {
    expect(matchDestinations(ITEMS, 'zzzz')).toHaveLength(0);
  });
});

describe('foldForSearch', () => {
  it('folds accents and case', () => {
    expect(foldForSearch('Éléments Masqués')).toBe('elements masques');
  });
});
