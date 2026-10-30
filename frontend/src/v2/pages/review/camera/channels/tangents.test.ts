// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { emptyAnim, upsertKey, type CameraAnimV2, type CurveKey, type KeyRef } from './model';
import { evalChannel } from './hermite';
import {
  channelRefs,
  clampWeight,
  handleSpanMs,
  isBroken,
  isWeighted,
  setBroken,
  setTangentSlope,
  setTangentType,
  setWeighted,
  slopeIn,
  slopeOut,
  typeIn,
  typeOut,
  weightFromSpan,
} from './tangents';

/** Three asymmetric keys: the smoothed slope of the middle key is NOT zero. */
function asymmetric(): CameraAnimV2 {
  let a = upsertKey(emptyAnim(), 'px', 0, 0);
  a = upsertKey(a, 'px', 1000, 10);
  return upsertKey(a, 'px', 2000, 30);
}

const middle: KeyRef[] = [{ channel: 'px', index: 1 }];
const keysOf = (a: CameraAnimV2): CurveKey[] => a.channels.px?.keys ?? [];
const key = (a: CameraAnimV2, i = 1): CurveKey => keysOf(a)[i];

/** "Legacy" re-read: we drop the split sides and keep only the unified mode. */
function asLegacy(a: CameraAnimV2): CameraAnimV2 {
  const keys = keysOf(a).map((k) => {
    const copy: CurveKey = { ...k };
    delete copy.modeIn;
    delete copy.modeOut;
    delete copy.broken;
    return copy;
  });
  return { ...a, channels: { px: { keys } } };
}

describe('tangents — per-side types', () => {
  it('an absent side falls back to the unified mode (data from before split sides)', () => {
    const k: CurveKey = { t: 0, v: 0, mode: 'linear' };
    expect(typeIn(k)).toBe('linear');
    expect(typeOut(k)).toBe('linear');
    expect(typeIn({ ...k, modeIn: 'flat' })).toBe('flat');
    expect(typeOut({ ...k, modeIn: 'flat' })).toBe('linear');
  });

  it('the slopes read use the original formulas (auto, linear, step, free)', () => {
    const keys = keysOf(asymmetric());
    // auto = Catmull-Rom over the neighbours: (30 − 0) / 2000.
    expect(slopeOut(keys, 1)).toBeCloseTo(0.015, 9);
    expect(slopeIn(keys, 1)).toBeCloseTo(0.015, 9);
    // linear: the chord toward the neighbour on the side considered.
    const lin = keys.map((k) => ({ ...k, mode: 'linear' as const }));
    expect(slopeOut(lin, 1)).toBeCloseTo(0.02, 9);
    expect(slopeIn(lin, 1)).toBeCloseTo(0.01, 9);
    // free: the written handles; step keeps the smoothed slope (the step short-circuits the read).
    const free = keys.map((k) => ({ ...k, mode: 'free' as const, tin: 0.5, tout: -0.5 }));
    expect(slopeIn(free, 1)).toBe(0.5);
    expect(slopeOut(free, 1)).toBe(-0.5);
    const step = keys.map((k) => ({ ...k, mode: 'step' as const }));
    expect(slopeOut(step, 1)).toBeCloseTo(0.015, 9);
  });

  it('flat enforces a zero slope on the targeted side only', () => {
    const a = setTangentType(asymmetric(), middle, 'flat', 'out');
    const keys = keysOf(a);
    expect(slopeOut(keys, 1)).toBe(0);
    expect(slopeIn(keys, 1)).toBeCloseTo(0.015, 9);
    expect(isBroken(key(a))).toBe(true);
  });
});

describe('tangents — pulled handle (the fixed bug)', () => {
  it('unified key: both sides follow the pulled slope', () => {
    const a = setTangentSlope(asymmetric(), 'px', 1, 'out', 0.02);
    const k = key(a);
    expect(k.tout).toBeCloseTo(0.02, 9);
    expect(k.tin).toBeCloseTo(0.02, 9);
    expect(k.mode).toBe('free');
  });

  it('broken key: the side not pulled keeps the slope the read already computed', () => {
    const base = asymmetric();
    const broken = setBroken(base, middle, true);
    const a = setTangentSlope(broken, 'px', 1, 'out', 0.02);
    const k = key(a);
    // Materialized at 0.015 (the smoothed slope), and NOT left undefined — read back as 0, it flattened
    // the incoming segment abruptly.
    expect(k.tin).toBeCloseTo(0.015, 9);
    expect(k.tout).toBeCloseTo(0.02, 9);
    // The incoming segment is unchanged, up to floating point.
    for (const t of [200, 500, 900]) {
      expect(evalChannel(a.channels.px, t, 0)).toBeCloseTo(evalChannel(base.channels.px, t, 0), 9);
    }
  });

  it('a neighbouring step is not carried away by the twin handle', () => {
    const stepped = setTangentType(asymmetric(), middle, 'step');
    const a = setTangentSlope(stepped, 'px', 1, 'in', 0.03);
    expect(typeOut(key(a))).toBe('step');
    expect(key(a).mode).toBe('step');
  });

  it('on an absent key, nothing is written', () => {
    const a = asymmetric();
    expect(setTangentSlope(a, 'px', 42, 'out', 1)).toEqual(a);
  });
});

describe('tangents — legacy re-read invariant', () => {
  it.each([
    ['flat', 700],
    ['free', 700],
    ['linear', 1500],
  ] as const)('un profil %s se relit à l’identique sans les côtés séparés', (type, at) => {
    const a = setTangentType(asymmetric(), middle, type);
    expect(evalChannel(asLegacy(a).channels.px, at, 0)).toBeCloseTo(evalChannel(a.channels.px, at, 0), 9);
  });

  it('a profile on both sides unifies, on one side only breaks', () => {
    const both = setTangentType(asymmetric(), middle, 'flat');
    expect(isBroken(key(both))).toBe(false);
    const one = setTangentType(both, middle, 'linear', 'in');
    expect(isBroken(key(one))).toBe(true);
    expect(typeIn(key(one))).toBe('linear');
    expect(typeOut(key(one))).toBe('flat');
  });

  it('step is only written on the outgoing side, even when requested on the incoming side', () => {
    const a = setTangentType(asymmetric(), middle, 'step', 'in');
    expect(typeOut(key(a))).toBe('step');
    expect(key(a).modeIn).toBeUndefined();
    // The incoming side stays smoothed — exactly what the unified `step` mode read.
    expect(slopeIn(keysOf(a), 1)).toBeCloseTo(0.015, 9);
  });
});

describe('tangents — unify, break, weight', () => {
  it('unifying aligns both sides on the average of the free slopes', () => {
    let a = setTangentType(asymmetric(), middle, 'free');
    a = setTangentSlope(setBroken(a, middle, true), 'px', 1, 'out', 0.03);
    a = setTangentSlope(a, 'px', 1, 'in', 0.01);
    a = setBroken(a, middle, false);
    expect(key(a).tin).toBeCloseTo(0.02, 9);
    expect(key(a).tout).toBeCloseTo(0.02, 9);
    expect(isBroken(key(a))).toBe(false);
  });

  it('weighting activates at 1 (curve unchanged) and is cleanly removed', () => {
    const base = asymmetric();
    const a = setWeighted(base, middle, true);
    expect(isWeighted(key(a))).toBe(true);
    expect(key(a).wIn).toBe(1);
    expect(key(a).wOut).toBe(1);
    // Weight 1 = Hermite: the curve does not move on activation.
    expect(evalChannel(a.channels.px, 500, 0)).toBeCloseTo(evalChannel(base.channels.px, 500, 0), 6);
    const off = setWeighted(a, middle, false);
    expect(isWeighted(key(off))).toBe(false);
  });

  it('handle length and weight derive from one another', () => {
    const a = setWeighted(asymmetric(), middle, true);
    const keys = keysOf(a);
    // Weight 1: a third of the neighbouring segment (1000 ms incoming, 1000 ms outgoing).
    expect(handleSpanMs(keys, 1, 'in')).toBeCloseTo(1000 / 3, 6);
    expect(weightFromSpan(keys, 1, 'in', 500)).toBeCloseTo(1.5, 6);
    // Unweighted key: no time length (handle at a fixed screen length).
    expect(handleSpanMs(keysOf(asymmetric()), 1, 'in')).toBeNull();
    // Without a neighbour, the weight is meaningless.
    expect(weightFromSpan(keys, 2, 'out', 100)).toBeNull();
    expect(clampWeight(99)).toBe(1.5);
    expect(clampWeight(0)).toBe(0.05);
  });

  it('channelRefs designates all the keys of a curve', () => {
    expect(channelRefs(asymmetric(), 'px')).toEqual([
      { channel: 'px', index: 0 },
      { channel: 'px', index: 1 },
      { channel: 'px', index: 2 },
    ]);
    expect(channelRefs(emptyAnim(), 'py')).toEqual([]);
  });
});
