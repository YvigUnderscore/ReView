// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { emptyAnim, upsertKey, type CameraAnimV2, type KeyRef } from './model';
import { keyBounds, scaleFactor, scaleKeyMoves } from './scaleKeys';

/** Trois clés sur deux canaux : de quoi éprouver des bornes multi-courbes. */
function anim(): CameraAnimV2 {
  let a = upsertKey(emptyAnim(), 'px', 0, 0);
  a = upsertKey(a, 'px', 1000, 10);
  return upsertKey(a, 'py', 500, -4);
}

const all: KeyRef[] = [
  { channel: 'px', index: 0 },
  { channel: 'px', index: 1 },
  { channel: 'py', index: 0 },
];

describe('keyBounds', () => {
  it('englobe les clés sélectionnées, tous canaux confondus', () => {
    expect(keyBounds(anim(), all)).toEqual({ tMin: 0, tMax: 1000, vMin: -4, vMax: 10 });
  });

  it('rend null quand la sélection ne désigne rien', () => {
    expect(keyBounds(anim(), [])).toBeNull();
    expect(keyBounds(anim(), [{ channel: 'pz', index: 2 }])).toBeNull();
  });
});

describe('scaleKeyMoves', () => {
  it('éloigne les clés du pivot du facteur donné, axe par axe', () => {
    const moves = scaleKeyMoves(anim(), all, { pivotT: 0, scaleT: 2, pivotV: 0, scaleV: 1 });
    expect(moves).toEqual([
      { channel: 'px', index: 0, t: 0, v: 0 },
      { channel: 'px', index: 1, t: 2000, v: 10 },
      { channel: 'py', index: 0, t: 1000, v: -4 },
    ]);
  });

  it('un pivot tenu par une clé la laisse en place', () => {
    const moves = scaleKeyMoves(anim(), all, { pivotT: 1000, scaleT: 0.5, pivotV: 10, scaleV: 0.5 });
    expect(moves[1]).toEqual({ channel: 'px', index: 1, t: 1000, v: 10 });
    expect(moves[0]).toEqual({ channel: 'px', index: 0, t: 500, v: 5 });
  });

  it('les temps ne passent jamais sous zéro et suivent le snap fourni', () => {
    const moves = scaleKeyMoves(anim(), all, {
      pivotT: 1000,
      scaleT: 3,
      pivotV: 0,
      scaleV: 1,
      snapTime: (t) => Math.round(t / 100) * 100,
    });
    // 0 → 1000 + (0 − 1000) × 3 = −2000, borné à 0.
    expect(moves[0].t).toBe(0);
    // 500 → 1000 + (500 − 1000) × 3 = −500, borné à 0 ; la clé de px reste au pivot.
    expect(moves[2].t).toBe(0);
    expect(moves[1].t).toBe(1000);
  });

  it('ignore une référence disparue', () => {
    const moves = scaleKeyMoves(anim(), [{ channel: 'px', index: 9 }], {
      pivotT: 0,
      scaleT: 2,
      pivotV: 0,
      scaleV: 2,
    });
    expect(moves).toEqual([]);
  });
});

describe('scaleFactor', () => {
  it('rapporte les distances au pivot', () => {
    expect(scaleFactor(500, 600, 0, 1)).toBeCloseTo(1.2, 9);
    expect(scaleFactor(500, 250, 0, 1)).toBeCloseTo(0.5, 9);
  });

  it('reste à 1 quand le geste part du pivot (rapport instable)', () => {
    expect(scaleFactor(1000.5, 2000, 1000, 1)).toBe(1);
  });
});
