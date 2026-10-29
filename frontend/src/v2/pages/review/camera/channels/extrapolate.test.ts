// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { emptyAnim, setChannelExtrapolation, upsertKey, type CameraAnimV2 } from './model';
import { evalChannel } from './hermite';
import { extrapolateValue } from './extrapolate';

/** Two linear keys: 0 → 10 over one second, so a slope of 0.01 unit/ms. */
const ramp = (): CameraAnimV2 =>
  upsertKey(upsertKey(emptyAnim(), 'px', 0, 0, 'linear'), 'px', 1000, 10, 'linear');

const at = (a: CameraAnimV2, t: number) => evalChannel(a.channels.px, t, 0);

describe('extrapolate — constant default', () => {
  it('without settings, the curve holds its extreme value (original behavior)', () => {
    const a = ramp();
    expect(at(a, -500)).toBe(0);
    expect(at(a, 1500)).toBe(10);
  });

  it('"constant" writes nothing: the channel recovers its original shape', () => {
    let a = setChannelExtrapolation(ramp(), 'px', { pre: 'cycle', post: 'cycle' });
    expect(a.channels.px?.pre).toBe('cycle');
    a = setChannelExtrapolation(a, 'px', { pre: 'constant', post: 'constant' });
    expect(a.channels.px?.pre).toBeUndefined();
    expect(a.channels.px?.post).toBeUndefined();
    expect(at(a, 1500)).toBe(10);
  });
});

describe('extrapolate — cycles and extensions', () => {
  it('cycle replays the curve on both sides', () => {
    const a = setChannelExtrapolation(ramp(), 'px', { pre: 'cycle', post: 'cycle' });
    expect(at(a, 1500)).toBeCloseTo(5, 6);
    expect(at(a, -500)).toBeCloseTo(5, 6);
  });

  it('cycle with offset accumulates the period gap', () => {
    const a = setChannelExtrapolation(ramp(), 'px', { pre: 'cycleOffset', post: 'cycleOffset' });
    expect(at(a, 1500)).toBeCloseTo(15, 6);
    expect(at(a, 2500)).toBeCloseTo(25, 6);
    expect(at(a, -500)).toBeCloseTo(-5, 6);
  });

  it('linear extends the slope touching the curve', () => {
    const a = setChannelExtrapolation(ramp(), 'px', { pre: 'linear', post: 'linear' });
    expect(at(a, 1500)).toBeCloseTo(15, 6);
    expect(at(a, -500)).toBeCloseTo(-5, 6);
  });

  it('oscillate goes back and forth (one round trip per period)', () => {
    const a = setChannelExtrapolation(ramp(), 'px', { pre: 'oscillate', post: 'oscillate' });
    expect(at(a, 1200)).toBeCloseTo(8, 6);
    expect(at(a, 2200)).toBeCloseTo(2, 6);
    expect(at(a, -200)).toBeCloseTo(2, 6);
  });

  it('a curve with no time span has no cycle to replay', () => {
    const keys = [
      { t: 500, v: 3, mode: 'auto' as const },
      { t: 500, v: 7, mode: 'auto' as const },
    ];
    expect(extrapolateValue(keys, 'cycle', 'post', 900, () => 42)).toBe(7);
    expect(extrapolateValue(keys, 'oscillate', 'pre', 100, () => 42)).toBe(3);
  });
});
