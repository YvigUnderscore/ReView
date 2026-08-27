// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { foldForSearch, matchDestinations } from './paletteMatch';

/**
 * La palette proposait quatre destinations, et les faisait disparaître dès la première
 * lettre tapée : impossible d'y faire ce pour quoi une palette existe, taper « kanb » pour
 * aller au kanban. Le filtrage se fait ici, `Command` étant monté avec
 * `shouldFilter={false}`.
 */
const ITEMS = [
  { key: 'kanban', label: 'Kanban' },
  { key: 'admin', label: 'Réglages' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'shots', label: 'Shots' },
];

describe('matchDestinations', () => {
  it('rend tout quand rien n’est tapé', () => {
    expect(matchDestinations(ITEMS, '')).toHaveLength(4);
    expect(matchDestinations(ITEMS, '   ')).toHaveLength(4);
  });

  it('trouve une destination sur un début de mot', () => {
    expect(matchDestinations(ITEMS, 'kanb').map((i) => i.key)).toEqual(['kanban']);
  });

  it('ignore les accents et la casse', () => {
    expect(matchDestinations(ITEMS, 'reglages').map((i) => i.key)).toEqual(['admin']);
    expect(matchDestinations(ITEMS, 'RÉGLAGES').map((i) => i.key)).toEqual(['admin']);
  });

  it('accepte aussi la clé technique, stable d’une langue à l’autre', () => {
    expect(matchDestinations(ITEMS, 'admin').map((i) => i.key)).toEqual(['admin']);
  });

  it('ne rend rien quand rien ne correspond — le message « aucun résultat » doit pouvoir sortir', () => {
    expect(matchDestinations(ITEMS, 'zzzz')).toHaveLength(0);
  });
});

describe('foldForSearch', () => {
  it('replie accents et casse', () => {
    expect(foldForSearch('Éléments Masqués')).toBe('elements masques');
  });
});
