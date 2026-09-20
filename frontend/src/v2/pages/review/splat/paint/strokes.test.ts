// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DEFAULT_STROKE_PX, MAX_STROKE_PX, MIN_STROKE_PX, clampStrokeWidth, decodeStrokes } from './strokes';

/**
 * `strokeRadius` a disparu avec le tube en unités monde : l'épaisseur est désormais un nombre de
 * pixels d'écran, tenu par `LineMaterial`, et il n'y a plus de rayon à dériver de la taille de la
 * scène. Le test qui verrouillait cette proportionnalité est donc remplacé, en connaissance de
 * cause, par celui de la seule normalisation qui reste : les bornes de l'épaisseur.
 */
describe('clampStrokeWidth', () => {
  it('borne l’épaisseur relue et retombe sur le défaut si elle est illisible', () => {
    expect(clampStrokeWidth(0)).toBe(MIN_STROKE_PX);
    expect(clampStrokeWidth(1000)).toBe(MAX_STROKE_PX);
    expect(clampStrokeWidth(4)).toBe(4);
    expect(clampStrokeWidth(undefined)).toBe(DEFAULT_STROKE_PX);
    expect(clampStrokeWidth(Number.NaN)).toBe(DEFAULT_STROKE_PX);
    expect(clampStrokeWidth('3')).toBe(DEFAULT_STROKE_PX);
  });
});

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
    expect(strokes[0].width).toBe(2);
  });

  it('tolère les annotations non-tableau (null, objet, chaîne)', () => {
    expect(decodeStrokes(null)).toEqual([]);
    expect(decodeStrokes({ type: 'splat-paint' })).toEqual([]);
    expect(decodeStrokes('x')).toEqual([]);
  });

  it('normalise l’épaisseur du trait relu — elle ne peut être ni nulle ni démesurée', () => {
    const [thin, fat] = decodeStrokes([
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 0 },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 900 },
    ]);
    expect(thin.width).toBe(MIN_STROKE_PX);
    expect(fat.width).toBe(MAX_STROKE_PX);
  });

  it('garde une normale exploitable et écarte celle qui ne l’est pas', () => {
    const [kept, dropped, malformed] = decodeStrokes([
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 2, normal: [0, 0, 1] },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 2, normal: [0, 0] },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 2, normal: 'x' },
    ]);
    expect(kept.normal).toEqual([0, 0, 1]);
    expect(dropped.normal).toBeUndefined();
    expect(malformed.normal).toBeUndefined();
  });

  it('accepte un trait antérieur à la normale : il reste lisible tel quel', () => {
    const [stroke] = decodeStrokes([
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#abcdef', width: 3 },
    ]);
    expect(stroke.normal).toBeUndefined();
    expect(stroke.points).toEqual([0, 0, 0, 1, 1, 1]);
  });
});
