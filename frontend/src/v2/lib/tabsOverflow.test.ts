// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { computeVisibleTabs, splitTabs } from './tabsOverflow';

describe('computeVisibleTabs', () => {
  it('montre tout quand la barre est assez large', () => {
    expect(computeVisibleTabs([100, 100, 100], 8, 400, 40)).toBe(3);
  });

  it('tient compte des gouttières pour décider que tout tient', () => {
    // 3 × 100 + 2 × 8 = 316 : tient à 316, pas à 315.
    expect(computeVisibleTabs([100, 100, 100], 8, 316, 40)).toBe(3);
    expect(computeVisibleTabs([100, 100, 100], 8, 315, 40)).toBe(2);
  });

  it('réserve la place du bouton de débordement', () => {
    // budget = 300 - 40 - 8 = 252 → 100 + 8 + 100 = 208 tient, +108 = 316 non.
    expect(computeVisibleTabs([100, 100, 100, 100], 8, 300, 40)).toBe(2);
  });

  it('renvoie 0 quand même un seul onglet ne tient pas avec le bouton', () => {
    expect(computeVisibleTabs([200, 200], 8, 150, 40)).toBe(0);
  });

  it('montre tout tant que le conteneur n’est pas mesuré', () => {
    expect(computeVisibleTabs([100, 100], 8, 0, 40)).toBe(2);
  });

  it('gère une liste vide', () => {
    expect(computeVisibleTabs([], 8, 500, 40)).toBe(0);
  });
});

describe('splitTabs', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('ne déborde pas quand tout tient', () => {
    expect(splitTabs(items, 5, 0)).toEqual({ visible: items, overflow: [] });
    expect(splitTabs(items, 9, 0).overflow).toEqual([]);
  });

  it('découpe dans l’ordre quand l’actif est déjà visible', () => {
    expect(splitTabs(items, 3, 1)).toEqual({ visible: ['a', 'b', 'c'], overflow: ['d', 'e'] });
  });

  it('remonte l’onglet actif à la dernière place visible', () => {
    expect(splitTabs(items, 3, 4)).toEqual({ visible: ['a', 'b', 'e'], overflow: ['d', 'c'] });
  });

  it('n’altère pas la liste d’origine', () => {
    const source = [...items];
    splitTabs(source, 2, 4);
    expect(source).toEqual(items);
  });

  it('ne remonte rien si aucune place n’est visible', () => {
    expect(splitTabs(items, 0, 3)).toEqual({ visible: [], overflow: items });
  });

  it('ignore un index actif hors bornes', () => {
    expect(splitTabs(items, 2, 99)).toEqual({ visible: ['a', 'b'], overflow: ['c', 'd', 'e'] });
  });
});
