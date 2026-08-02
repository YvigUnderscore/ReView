// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { decodeStrokes, strokeRadius } from './strokes';

describe('decodeStrokes', () => {
  it("extrait les traits valides d'un tableau d'annotation mixte (hotspot + 2D + traits)", () => {
    const annotation = [
      { type: 'hotspot', position: '0 0 0', normal: '0 0 1' },
      { type: 'pen', points: [[0, 0]] },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#ff0000', width: 2 },
      { type: 'splat-paint', points: [0, 0, 0], color: '#00ff00', width: 1 }, // trop court
      { type: 'splat-paint', points: [0, 0, 0, 1, NaN, 1], color: '#0000ff', width: 1 }, // NaN
      { type: 'splat-paint', points: [0, 0, 0, 1, 1], color: '#0000ff', width: 1 }, // pas multiple de 3
    ];
    const strokes = decodeStrokes(annotation);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].color).toBe('#ff0000');
  });

  it('tolère les annotations non-tableau (null, objet, chaîne)', () => {
    expect(decodeStrokes(null)).toEqual([]);
    expect(decodeStrokes({ type: 'splat-paint' })).toEqual([]);
    expect(decodeStrokes('x')).toEqual([]);
  });
});

describe('strokeRadius', () => {
  it("proportionnel à la taille de scène et à l'épaisseur, jamais nul", () => {
    expect(strokeRadius(10, 2)).toBeCloseTo(0.05);
    expect(strokeRadius(10, 4)).toBeCloseTo(0.1);
    expect(strokeRadius(0, 1)).toBeGreaterThan(0);
  });
});
