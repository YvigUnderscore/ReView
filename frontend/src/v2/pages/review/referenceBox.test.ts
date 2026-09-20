// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  clampRefBox,
  fitBands,
  NO_BANDS,
  pastedRefBox,
  REF_MIN_WIDTH,
  REF_PASTE_WIDTH,
  REF_POS_LIMIT,
  type ViewerBands,
} from './referenceBox';

/**
 * Deux défauts opposés se sont succédé : le collage posait d'abord à x = 1.05 sans bornage
 * (invisible, irrattrapable), puis tout a été borné à 0..1 (la référence se collait d'office
 * SUR l'image). La règle tient les deux bouts : la zone atteignable est le média **plus** les
 * bandes que le letterbox laisse autour de lui.
 */
const bands = (over: Partial<ViewerBands> = {}): ViewerBands => ({ ...NO_BANDS, ...over });
const SIDE = bands({ left: 0.5, right: 0.5 });

describe('fitBands', () => {
  it('donne des bandes latérales quand le viewer est plus large que le média', () => {
    expect(fitBands(1, 2)).toEqual({ left: 0.5, right: 0.5, top: 0, bottom: 0 });
  });

  it('donne des bandes haut/bas quand le média est plus large que le viewer', () => {
    expect(fitBands(2, 1)).toEqual({ left: 0, right: 0, top: 0.5, bottom: 0.5 });
  });

  it('ne donne aucune bande quand les deux aspects coïncident', () => {
    expect(fitBands(16 / 9, 16 / 9)).toEqual(NO_BANDS);
  });

  it('ne donne aucune bande faute de mesure (conteneur sans hauteur)', () => {
    expect(fitBands(NaN, 2)).toEqual(NO_BANDS);
    expect(fitBands(1, 0)).toEqual(NO_BANDS);
  });

  it('plafonne une bande démesurée au débordement atteignable', () => {
    expect(fitBands(0.01, 10).right).toBe(REF_POS_LIMIT);
  });
});

describe('clampRefBox', () => {
  it('conserve une référence posée hors cadre, dans la bande', () => {
    expect(clampRefBox({ x: 1.1, y: 0.2, width: 0.3 }, SIDE).x).toBeCloseTo(1.1);
    expect(clampRefBox({ x: -0.4, y: 0.2, width: 0.3 }, SIDE).x).toBeCloseTo(-0.4);
  });

  it('ne laisse pas sortir la référence de la bande', () => {
    expect(clampRefBox({ x: 5, y: 0, width: 0.3 }, SIDE).x).toBeCloseTo(1.2);
    expect(clampRefBox({ x: -5, y: 0, width: 0.3 }, SIDE).x).toBeCloseTo(-0.5);
    const vertical = bands({ top: 0.4, bottom: 0.4 });
    expect(clampRefBox({ x: 0.2, y: -3, width: 0.3 }, vertical).y).toBeCloseTo(-0.4);
    expect(clampRefBox({ x: 0.2, y: 9, width: 0.3 }, vertical).y).toBeCloseTo(1.35);
  });

  it('plafonne une bande démesurée : la référence reste rattrapable', () => {
    expect(clampRefBox({ x: -99, y: 0, width: 0.3 }, bands({ left: 99 })).x).toBe(-REF_POS_LIMIT);
  });

  it('ramène dans le cadre une position héritée quand aucune bande ne l’accueille', () => {
    const box = clampRefBox({ x: 1.05, y: 0, width: 0.3 });
    expect(box.x).toBeCloseTo(0.7);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    // Une bande trop courte pour la largeur ne suffit pas non plus.
    expect(clampRefBox({ x: 1.05, y: 0, width: 0.3 }, bands({ right: 0.1 })).x).toBeCloseTo(0.8);
  });

  it('laisse intacte une position déjà dans le cadre', () => {
    expect(clampRefBox({ x: 0.2, y: 0.3, width: 0.4 })).toEqual({ x: 0.2, y: 0.3, width: 0.4 });
  });

  it('borne les débordements sans bande, et la hauteur utile', () => {
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
  it('pose la référence À CÔTÉ du média quand la bande droite l’accueille', () => {
    const box = pastedRefBox(0, SIDE);
    expect(box.x).toBeGreaterThanOrEqual(1);
    expect(box.x + box.width).toBeLessThanOrEqual(1 + SIDE.right);
    expect(box.y).toBeGreaterThanOrEqual(0);
  });

  it('se rabat sur la bande gauche quand elle est seule disponible', () => {
    const box = pastedRefBox(0, bands({ left: 0.6 }));
    expect(box.x + box.width).toBeLessThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(-0.6);
  });

  it('retombe sur un coin du média quand rien ne l’entoure', () => {
    const box = pastedRefBox(0);
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThan(0);
    expect(box.y).toBeLessThan(0.5);
  });

  it('retombe aussi sur un coin quand la bande est trop courte pour la référence', () => {
    const narrow = pastedRefBox(0, bands({ right: REF_PASTE_WIDTH / 2 }));
    expect(narrow.x).toBeLessThan(1);
  });

  it('cascade dans la bande sans en sortir', () => {
    const first = pastedRefBox(0, SIDE);
    const second = pastedRefBox(1, SIDE);
    expect(second.x).toBeCloseTo(first.x);
    expect(second.y).toBeGreaterThan(first.y);
    for (let i = 0; i < 12; i++) {
      const box = pastedRefBox(i, SIDE);
      expect(box.x + box.width).toBeLessThanOrEqual(1 + SIDE.right);
      expect(box.y).toBeLessThan(1);
    }
  });

  it('cascade sur le média, dans le cadre, quand il n’y a pas de bande', () => {
    for (let i = 0; i < 12; i++) {
      const box = pastedRefBox(i);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1);
      expect(box.y).toBeLessThan(1);
    }
    expect(pastedRefBox(1).x).toBeGreaterThan(pastedRefBox(0).x);
  });
});
