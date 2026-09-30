// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { USER_COLORS, contrastRatio, readableInk, userColor } from './userColor';

describe('userColor', () => {
  it('rend la même teinte pour le même identifiant', () => {
    expect(userColor(42)).toBe(userColor(42));
    expect(userColor('ana')).toBe(userColor('ana'));
  });

  it('reste dans la palette', () => {
    for (const seed of [0, 1, 7, 99, 'ana', 'milo']) {
      expect(USER_COLORS).toContain(userColor(seed));
    }
  });
});

describe('readableInk — lisibilité des initiales (WCAG AA)', () => {
  /**
   * Les initiales étaient écrites en blanc sur toute la palette : AUCUNE des douze teintes ne
   * tenait 4,5:1 ainsi — de 1,98:1 sur le vert citron à 4,47:1 au mieux. Ce test vaut pour
   * toute teinte ajoutée plus tard : une couleur qu'aucune encre ne rend lisible échoue ici.
   */
  it.each([...USER_COLORS])('%s porte une encre qui tient 4,5:1', (color) => {
    expect(contrastRatio(color, readableInk(color))).toBeGreaterThanOrEqual(4.5);
  });

  it('le blanc seul n’y suffisait pas — c’est la raison du calcul', () => {
    const failing = USER_COLORS.filter((c) => contrastRatio(c, '#ffffff') < 4.5);
    expect(failing).toHaveLength(USER_COLORS.length);
  });

  it('choisit l’encre la plus contrastée des deux', () => {
    expect(readableInk('#ffffff')).toBe('#000000');
    expect(readableInk('#000000')).toBe('#ffffff');
  });
});

describe('contrastRatio', () => {
  it('rend 21:1 entre noir et blanc, 1:1 pour une couleur avec elle-même', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5);
  });
});
