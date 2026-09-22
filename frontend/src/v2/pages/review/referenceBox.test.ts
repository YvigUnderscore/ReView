// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  fitBands,
  MEDIA_CANVAS,
  NO_BANDS,
  onCanvasRefBox,
  pastedRefBox,
  placeRefBox,
  REF_MIN_WIDTH,
  REF_PASTE_WIDTH,
  REF_POS_LIMIT,
  rescueRefBox,
  type ViewerBands,
} from './referenceBox';

/**
 * Trois bornages se sont succédé et aucun n'a rendu le geste libre : le collage posait d'abord
 * à x = 1.05 sans limite (invisible, irrattrapable), puis tout a été borné à 0..1 (la référence
 * se collait d'office SUR l'image), puis aux bandes du letterbox — qui interdisent encore les
 * côtés dès que le letterbox est horizontal.
 *
 * La règle tient désormais les deux bouts en séparant les deux moments : le geste ne connaît
 * aucune bande (`placeRefBox`), et l'affichage ne rattrape que ce qu'aucun viewer ne montrerait
 * (`rescueRefBox`).
 */
const bands = (over: Partial<ViewerBands> = {}): ViewerBands => ({ ...NO_BANDS, ...over });
const SIDE = bands({ left: 0.5, right: 0.5 });
const VERTICAL = bands({ top: 0.4, bottom: 0.4 });

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

describe('placeRefBox', () => {
  it('garde le point de dépôt tel quel, hors du cadre du média comme dedans', () => {
    expect(placeRefBox({ x: 1.4, y: -0.6, width: 0.3 })).toEqual({ x: 1.4, y: -0.6, width: 0.3 });
    expect(placeRefBox({ x: 0.2, y: 0.3, width: 0.4 })).toEqual({ x: 0.2, y: 0.3, width: 0.4 });
  });

  it('garde un dépôt bien au-delà du cadre : aucune bande n’entre dans le geste', () => {
    expect(placeRefBox({ x: 2.5, y: 1.8, width: 0.3 })).toEqual({ x: 2.5, y: 1.8, width: 0.3 });
  });

  it('s’arrête au plafond partagé avec le serveur, qui refuserait l’envoi', () => {
    expect(placeRefBox({ x: 9, y: -9, width: 0.3 })).toEqual({
      x: REF_POS_LIMIT,
      y: -REF_POS_LIMIT,
      width: 0.3,
    });
  });

  it('plafonne la largeur à l’image et garde une taille attrapable', () => {
    expect(placeRefBox({ x: 0, y: 0, width: 3 }).width).toBe(1);
    expect(placeRefBox({ x: 0.5, y: 0.5, width: 0 }).width).toBe(REF_MIN_WIDTH);
  });

  it('ne propage pas un NaN venu d’un glisser sur un conteneur non mesuré', () => {
    expect(placeRefBox({ x: NaN, y: NaN, width: NaN })).toEqual({
      x: 0,
      y: 0,
      width: REF_MIN_WIDTH,
    });
  });
});

describe('onCanvasRefBox', () => {
  /** Ce que mesure un viewer plus large et plus haut que le média : de la place tout autour. */
  const CANVAS = { left: -1, top: -0.5, right: 2, bottom: 1.5 };

  it('laisse la référence n’importe où sur le canevas, hors du cadre du média', () => {
    expect(onCanvasRefBox({ x: 1.6, y: -0.4, width: 0.3 }, 0.4, CANVAS)).toEqual({
      x: 1.6,
      y: -0.4,
      width: 0.3,
    });
  });

  it('retient au bord ce qui sortirait du viewer, donc de toute prise', () => {
    expect(onCanvasRefBox({ x: 2.5, y: 0, width: 0.3 }, 0.4, CANVAS).x).toBeCloseTo(1.95);
    expect(onCanvasRefBox({ x: -2, y: 0, width: 0.3 }, 0.4, CANVAS).x).toBeCloseTo(-1.25);
    expect(onCanvasRefBox({ x: 0, y: 2.5, width: 0.3 }, 0.4, CANVAS).y).toBeCloseTo(1.45);
    expect(onCanvasRefBox({ x: 0, y: -2, width: 0.3 }, 0.4, CANVAS).y).toBeCloseTo(-0.85);
  });

  it('s’en tient au cadre du média faute de canevas mesuré', () => {
    const box = onCanvasRefBox({ x: 1.6, y: 0.2, width: 0.3 }, 0.4, MEDIA_CANVAS);
    expect(box.x).toBeCloseTo(0.95);
  });

  it('se rabat sur la part attrapable quand la hauteur n’est pas mesurable', () => {
    expect(onCanvasRefBox({ x: 0, y: -2, width: 0.3 }, 0, CANVAS).y).toBeCloseTo(-0.5);
    expect(onCanvasRefBox({ x: 0, y: -2, width: 0.3 }, NaN, CANVAS).y).toBeCloseTo(-0.5);
  });

  it('ne dépasse jamais le plafond que le serveur accepte, canevas immense ou non', () => {
    const huge = { left: -20, top: -20, right: 20, bottom: 20 };
    expect(onCanvasRefBox({ x: 40, y: -40, width: 0.3 }, 0.4, huge)).toEqual({
      x: REF_POS_LIMIT,
      y: -REF_POS_LIMIT,
      width: 0.3,
    });
  });
});

describe('rescueRefBox', () => {
  it('laisse exactement en place une référence dont on voit assez', () => {
    expect(rescueRefBox({ x: 0.2, y: 0.3, width: 0.4 })).toEqual({ x: 0.2, y: 0.3, width: 0.4 });
    expect(rescueRefBox({ x: 1.1, y: 0.2, width: 0.3 }, SIDE).x).toBeCloseTo(1.1);
    expect(rescueRefBox({ x: -0.4, y: 0.2, width: 0.3 }, SIDE).x).toBeCloseTo(-0.4);
    expect(rescueRefBox({ x: 0.2, y: -0.4, width: 0.3 }, VERTICAL).y).toBeCloseTo(-0.4);
  });

  it('laisse dépasser la référence du viewer tant qu’on en reconnaît une part', () => {
    expect(rescueRefBox({ x: 1.4, y: 0.2, width: 0.3 }, SIDE).x).toBeCloseTo(1.4);
  });

  it('ramène dans la zone visible ce qui n’y mord plus assez', () => {
    expect(rescueRefBox({ x: 1.45, y: 0, width: 0.3 }, SIDE).x).toBeCloseTo(1.2);
    expect(rescueRefBox({ x: 5, y: 0, width: 0.3 }, SIDE).x).toBeCloseTo(1.2);
    expect(rescueRefBox({ x: -5, y: 0, width: 0.3 }, SIDE).x).toBeCloseTo(-0.5);
    expect(rescueRefBox({ x: 0.2, y: -3, width: 0.3 }, VERTICAL).y).toBeCloseTo(-0.4);
    expect(rescueRefBox({ x: 0.2, y: 9, width: 0.3 }, VERTICAL).y).toBeCloseTo(1.35);
  });

  it('ramène dans le cadre une position héritée quand aucune bande ne l’accueille', () => {
    const box = rescueRefBox({ x: 1.05, y: 0, width: 0.3 });
    expect(box.x).toBeCloseTo(0.7);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    // Une bande trop courte pour en montrer une part reconnaissable ne suffit pas non plus.
    expect(rescueRefBox({ x: 1.05, y: 0, width: 0.3 }, bands({ right: 0.1 })).x).toBeCloseTo(0.8);
  });

  it('rattrape une position héritée aberrante sur les deux axes', () => {
    expect(rescueRefBox({ x: -2, y: -1, width: 0.2 })).toEqual({ x: 0, y: 0, width: 0.2 });
    expect(rescueRefBox({ x: 0, y: 4, width: 0.2 }).y).toBeLessThan(1);
  });

  it('plafonne une bande démesurée : la référence reste rattrapable', () => {
    expect(rescueRefBox({ x: -99, y: 0, width: 0.3 }, bands({ left: 99 })).x).toBe(-REF_POS_LIMIT);
  });

  it('ne propage pas un NaN enregistré en base', () => {
    expect(rescueRefBox({ x: NaN, y: NaN, width: NaN })).toEqual({
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

  it('pose SOUS le média quand le letterbox est horizontal', () => {
    const box = pastedRefBox(0, bands({ top: 0.6, bottom: 0.6 }));
    expect(box.y).toBeGreaterThan(1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
  });

  it('pose AU-DESSUS du média quand seule la bande haute l’accueille', () => {
    expect(pastedRefBox(0, bands({ top: 0.6 })).y).toBeLessThan(0);
  });

  it('retombe sur un coin du média quand rien ne l’entoure', () => {
    const box = pastedRefBox(0);
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThan(0);
    expect(box.y).toBeLessThan(0.5);
  });

  it('retombe aussi sur un coin quand la bande est trop courte pour la référence', () => {
    expect(pastedRefBox(0, bands({ right: REF_PASTE_WIDTH / 2 })).x).toBeLessThan(1);
    const flat = pastedRefBox(0, bands({ top: 0.2, bottom: 0.2 }));
    expect(flat.y).toBeGreaterThan(0);
    expect(flat.y).toBeLessThan(0.5);
  });

  it('cascade le long de la bande sans en sortir', () => {
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
