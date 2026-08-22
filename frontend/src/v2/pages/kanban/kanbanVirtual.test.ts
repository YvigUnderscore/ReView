// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { VIRTUALIZE_FROM, activeIndexIn, shouldVirtualize, withActiveIndex } from './kanbanVirtual';

/**
 * Les décisions de la colonne dense, hors DOM.
 *
 * Sur un long-métrage une colonne compte des centaines de cartes : ce qui se monte et ce
 * qui reste monté pendant un glisser tient à ces trois fonctions.
 */
describe('shouldVirtualize', () => {
  it('laisse une petite colonne se monter en entier', () => {
    expect(shouldVirtualize(0)).toBe(false);
    expect(shouldVirtualize(VIRTUALIZE_FROM)).toBe(false);
  });

  it('virtualise dès que la colonne dépasse le seuil', () => {
    expect(shouldVirtualize(VIRTUALIZE_FROM + 1)).toBe(true);
    expect(shouldVirtualize(2000)).toBe(true);
  });
});

describe('activeIndexIn', () => {
  const tasks = [{ id: 7 }, { id: 8 }, { id: 9 }];

  it('trouve la carte glissée quand elle appartient à la colonne', () => {
    expect(activeIndexIn(tasks, 9)).toBe(2);
  });

  it('rend -1 sans glisser en cours ou pour une carte d’une autre colonne', () => {
    expect(activeIndexIn(tasks, null)).toBe(-1);
    expect(activeIndexIn(tasks, 42)).toBe(-1);
  });
});

describe('withActiveIndex', () => {
  it('ne touche à rien sans glisser en cours', () => {
    expect(withActiveIndex([3, 4, 5], -1)).toEqual([3, 4, 5]);
  });

  it('ne duplique pas une carte déjà dans la fenêtre', () => {
    expect(withActiveIndex([3, 4, 5], 4)).toEqual([3, 4, 5]);
  });

  it('rajoute la carte glissée sortie de la fenêtre, en gardant l’ordre croissant', () => {
    // Le virtualiseur suppose une fenêtre triée : un index rajouté en queue placerait la
    // carte au mauvais décalage, et l'aperçu suivi par le curseur perdrait sa référence.
    expect(withActiveIndex([10, 11, 12], 2)).toEqual([2, 10, 11, 12]);
    expect(withActiveIndex([10, 11, 12], 900)).toEqual([10, 11, 12, 900]);
  });

  it('ne modifie pas la fenêtre reçue', () => {
    const range = [10, 11];
    withActiveIndex(range, 2);
    expect(range).toEqual([10, 11]);
  });
});
