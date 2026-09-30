// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  clampScale,
  isFit,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  wheelFactor,
  zoomBy,
  zoomStyle,
  zoomTo,
  ZOOM_FIT,
} from './viewportZoom';

/** Position écran (relative au centre) d'un point du calque, sous la transformation. */
const project = (state: { scale: number; x: number; y: number }, local: number) =>
  local * state.scale + state.x;

describe('zoomTo', () => {
  it('garde fixe le point sous le curseur', () => {
    const before = { scale: 1, x: 0, y: 0 };
    // Point du calque situé à 120 px du centre : il est à 120 px à l'écran avant zoom.
    const local = 120;
    const after = zoomTo(before, 4, project(before, local), 0);
    expect(project(after, local)).toBeCloseTo(120, 6);
  });

  it('zoom au centre : le centre ne bouge pas', () => {
    const after = zoomTo(ZOOM_FIT, 3, 0, 0);
    expect(after).toEqual({ scale: 3, x: 0, y: 0 });
  });

  it('borne l’échelle et rend l’état inchangé quand la borne est atteinte', () => {
    const maxed = zoomTo(ZOOM_FIT, 1000, 50, 50);
    expect(maxed.scale).toBe(MAX_SCALE);
    expect(zoomTo(maxed, 1000, 50, 50)).toBe(maxed);
    expect(zoomTo(ZOOM_FIT, 0, 0, 0).scale).toBe(MIN_SCALE);
  });
});

describe('zoomBy / panBy', () => {
  it('enchaîne les crans de molette sans dériver du point visé', () => {
    let s = ZOOM_FIT;
    const local = -80;
    for (let i = 0; i < 5; i++) s = zoomBy(s, wheelFactor(-1), project(s, local), 0);
    expect(s.scale).toBeGreaterThan(1.9);
    expect(project(s, local)).toBeCloseTo(-80, 6);
  });

  it('le pan est un simple décalage écran', () => {
    expect(panBy({ scale: 2, x: 10, y: -5 }, 4, 6)).toEqual({ scale: 2, x: 14, y: 1 });
  });

  it('la molette vers le bas éloigne', () => {
    expect(wheelFactor(120)).toBeLessThan(1);
    expect(wheelFactor(-120)).toBeGreaterThan(1);
  });
});

describe('zoomStyle / isFit', () => {
  it('ajusté : aucun style, le rendu reste celui d’avant le zoom', () => {
    expect(isFit(ZOOM_FIT)).toBe(true);
    expect(zoomStyle(ZOOM_FIT)).toEqual({});
  });

  it('zoomé : transformation centrée', () => {
    const style = zoomStyle({ scale: 2, x: 3, y: -4 });
    expect(style.transform).toBe('translate(3px, -4px) scale(2)');
    expect(style.transformOrigin).toBe('center center');
  });

  it('déplacé sans zoom : la vue n’est plus ajustée', () => {
    expect(isFit({ scale: 1, x: 12, y: 0 })).toBe(false);
  });
});

describe('clampScale', () => {
  it('rejette les valeurs non finies', () => {
    expect(clampScale(Number.NaN)).toBe(1);
  });
});
