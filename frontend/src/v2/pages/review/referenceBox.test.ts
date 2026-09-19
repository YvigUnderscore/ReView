// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { clampRefBox, pastedRefBox, REF_MIN_WIDTH } from './referenceBox';

/**
 * Le collage posait les références à x = 1.05, hors du cadre : invisibles, et la position
 * partait telle quelle en base. Le recadrage sert donc aussi à rattraper l'existant.
 */
describe('clampRefBox', () => {
  it('ramène dans le cadre une référence enregistrée hors cadre', () => {
    const box = clampRefBox({ x: 1.05, y: 0, width: 0.3 });
    expect(box.x).toBeCloseTo(0.7);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
  });

  it('laisse intacte une position déjà dans le cadre', () => {
    expect(clampRefBox({ x: 0.2, y: 0.3, width: 0.4 })).toEqual({ x: 0.2, y: 0.3, width: 0.4 });
  });

  it('borne les débordements négatifs et la hauteur utile', () => {
    expect(clampRefBox({ x: -2, y: -1, width: 0.2 })).toEqual({ x: 0, y: 0, width: 0.2 });
    expect(clampRefBox({ x: 0, y: 4, width: 0.2 }).y).toBeLessThan(1);
  });

  it('plafonne la largeur à l’image et garde une taille attrapable', () => {
    expect(clampRefBox({ x: 0, y: 0, width: 3 })).toEqual({ x: 0, y: 0, width: 1 });
    expect(clampRefBox({ x: 0.5, y: 0.5, width: 0 }).width).toBe(REF_MIN_WIDTH);
  });

  it('ne propage pas un NaN venu d’un glisser sur un conteneur non mesuré', () => {
    expect(clampRefBox({ x: NaN, y: NaN, width: NaN })).toEqual({
      x: 0,
      y: 0,
      width: REF_MIN_WIDTH,
    });
  });
});

describe('pastedRefBox', () => {
  it('pose la première référence dans le cadre, visible', () => {
    const box = pastedRefBox(0);
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThan(0);
    expect(box.y).toBeLessThan(0.5);
  });

  it('décale les suivantes sans jamais sortir du cadre', () => {
    for (let i = 0; i < 12; i++) {
      const box = pastedRefBox(i);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1);
      expect(box.y).toBeLessThan(1);
    }
    expect(pastedRefBox(1).x).toBeGreaterThan(pastedRefBox(0).x);
  });
});
