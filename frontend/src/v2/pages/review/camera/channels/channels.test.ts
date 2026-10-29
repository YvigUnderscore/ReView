// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import type { SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';
import {
  animDuration,
  animKeyTimes,
  animPlayDuration,
  deleteColumn,
  deleteKeys,
  emptyAnim,
  fromV1,
  hasAnimation,
  moveKey,
  moveKeysBatch,
  normalizeAnim,
  setAnimDuration,
  upsertKey,
  upsertPoseAt,
} from './model';
import { evalChannel, sampleAnimV2 } from './hermite';
import { setTangentSlope, setWeighted } from './tangents';

const base: SplatCamera = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
const pose = (x: number): SplatCamera => ({ position: { x, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });

describe('model — pure operations', () => {
  it('upsertKey inserts then overwrites at the same time, keeps the sort', () => {
    let a = upsertKey(emptyAnim(), 'px', 1000, 5);
    a = upsertKey(a, 'px', 0, 1);
    a = upsertKey(a, 'px', 1000, 9); // overwrites
    expect(a.channels.px?.keys.map((k) => [k.t, k.v])).toEqual([
      [0, 1],
      [1000, 9],
    ]);
  });

  it('animKeyTimes / animDuration / hasAnimation', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'py', 2000, 1);
    expect(animKeyTimes(a)).toEqual([0, 2000]);
    expect(animDuration(a)).toBe(2000);
    expect(hasAnimation(a)).toBe(true);
    expect(hasAnimation(upsertKey(emptyAnim(), 'px', 0, 0))).toBe(false); // a single column
  });

  it('moveKey re-sorts when the time goes past the next key', () => {
    let a = upsertPoseAt(emptyAnim(), 0, pose(0));
    a = upsertPoseAt(a, 1000, pose(10));
    a = moveKey(a, 'px', 0, { t: 2000 }); // goes past the other key
    expect(a.channels.px?.keys.map((k) => k.t)).toEqual([1000, 2000]);
  });

  it('deleteColumn removes the keys at one time on all channels', () => {
    let a = upsertPoseAt(emptyAnim(), 0, pose(0));
    a = upsertPoseAt(a, 1000, pose(10));
    a = deleteColumn(a, 1000);
    expect(animKeyTimes(a)).toEqual([0]);
  });

  it('moveKeysBatch moves a multi-channel batch from the baseline indices', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'px', 1000, 5);
    a = upsertKey(a, 'py', 1000, 3);
    // Shifts the two keys at 1000 by +500 ms (index 1 on px, index 0 on py).
    const b = moveKeysBatch(a, [
      { channel: 'px', index: 1, t: 1500, v: 5 },
      { channel: 'py', index: 0, t: 1500, v: 3 },
    ]);
    expect(b.channels.px?.keys.map((k) => k.t)).toEqual([0, 1500]);
    expect(b.channels.py?.keys.map((k) => k.t)).toEqual([1500]);
  });

  it('deleteKeys removes a batch without shifting the remaining indices', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'px', 1000, 5);
    a = upsertKey(a, 'px', 2000, 9);
    const b = deleteKeys(a, [
      { channel: 'px', index: 0 },
      { channel: 'px', index: 2 },
    ]);
    expect(b.channels.px?.keys.map((k) => [k.t, k.v])).toEqual([[1000, 5]]);
  });

  it('adjustable duration: animPlayDuration takes the override, otherwise the last time', () => {
    let a = upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 1000, 10);
    expect(animPlayDuration(a)).toBe(1000);
    a = setAnimDuration(a, 3000);
    expect(animPlayDuration(a)).toBe(3000);
    a = setAnimDuration(a, 0); // back to automatic
    expect(a.durationMs).toBeUndefined();
    expect(animPlayDuration(a)).toBe(1000);
  });
});

describe('hermite — sampling', () => {
  it('evalChannel clamps to the ends', () => {
    const a = upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 1000, 10);
    expect(evalChannel(a.channels.px, -100, 0)).toBe(0);
    expect(evalChannel(a.channels.px, 1100, 0)).toBe(10);
  });

  it('linear mode = straight interpolation (midpoint = average)', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0, 'linear');
    a = upsertKey(a, 'px', 1000, 10, 'linear');
    expect(evalChannel(a.channels.px, 500, 0)).toBeCloseTo(5);
  });

  it('step mode holds the left value', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0, 'step');
    a = upsertKey(a, 'px', 1000, 10, 'step');
    expect(evalChannel(a.channels.px, 999, 0)).toBe(0);
    expect(evalChannel(a.channels.px, 1000, 0)).toBe(10);
  });

  it('auto mode passes exactly through the keys', () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'px', 1000, 10);
    a = upsertKey(a, 'px', 2000, 0);
    expect(evalChannel(a.channels.px, 1000, 0)).toBeCloseTo(10);
    expect(evalChannel(a.channels.px, 0, 0)).toBeCloseTo(0);
  });

  it('absent channel → value of the base pose', () => {
    const a = upsertKey(upsertKey(emptyAnim(), 'px', 0, 1), 'px', 1000, 2);
    const p = sampleAnimV2(a, 500, { ...base, target: { x: 7, y: 8, z: 9 } });
    expect(p.target).toEqual({ x: 7, y: 8, z: 9 }); // unanimated target = base
  });

  it('loop: wraps the time over the duration', () => {
    let a = upsertKey(emptyAnim(true), 'px', 0, 0, 'linear');
    a = upsertKey(a, 'px', 1000, 10, 'linear');
    expect(sampleAnimV2(a, 1500, base).position.x).toBeCloseTo(5); // 1500 % 1000 = 500
  });
});

describe('hermite — weighted tangents', () => {
  /** Smoothed ramp over three keys: enough to compare the weighted path and the Hermite path. */
  const curve = () => {
    let a = upsertKey(emptyAnim(), 'px', 0, 0);
    a = upsertKey(a, 'px', 1000, 10);
    return upsertKey(a, 'px', 2000, 30);
  };

  it('a weight of 1 reproduces the Hermite (a Hermite IS the weight-1 Bézier)', () => {
    const plain = curve();
    const weighted = setWeighted(plain, [{ channel: 'px', index: 0 }], true);
    for (const t of [100, 400, 900]) {
      expect(evalChannel(weighted.channels.px, t, 0)).toBeCloseTo(evalChannel(plain.channels.px, t, 0), 6);
    }
  });

  it('a stretched weight changes the shape but keeps the keys exact', () => {
    let a = setWeighted(curve(), [{ channel: 'px', index: 0 }], true);
    a = setTangentSlope(a, 'px', 0, 'out', 0.02, 1.5);
    expect(a.channels.px?.keys[0].wOut).toBeCloseTo(1.5, 9);
    // The keys stay on the curve, and the segment deviates from the unweighted one.
    expect(evalChannel(a.channels.px, 0, 0)).toBeCloseTo(0, 6);
    expect(evalChannel(a.channels.px, 1000, 0)).toBeCloseTo(10, 6);
    expect(evalChannel(a.channels.px, 500, 0)).not.toBeCloseTo(evalChannel(curve().channels.px, 500, 0), 3);
  });
});

describe('fromV1 / normalizeAnim — migration', () => {
  const v1: SplatCameraKeyframe[] = [
    { t: 0, pose: pose(0), easing: 'linear' },
    { t: 1000, pose: pose(10), easing: 'ease-in-out' },
  ];

  it('fromV1 creates one channel per quantity, migrates the easing into mode', () => {
    const a = fromV1(v1, true);
    expect(a.channels.px?.keys.map((k) => [k.t, k.v])).toEqual([
      [0, 0],
      [1000, 10],
    ]);
    expect(a.channels.px?.keys[0].mode).toBe('linear');
    expect(a.channels.px?.keys[1].mode).toBe('auto'); // ease-in-out → smoothed
  });

  it('normalizeAnim accepts v1, v2, and rejects the empty one', () => {
    expect(normalizeAnim({ keyframes: v1, loop: false })?.version).toBe(2);
    expect(normalizeAnim(fromV1(v1, true))?.version).toBe(2);
    expect(normalizeAnim(null)).toBeNull();
    expect(normalizeAnim({ keyframes: [v1[0]], loop: false })).toBeNull();
  });
});
