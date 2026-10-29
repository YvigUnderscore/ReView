// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { exactFrameRate, frameAtTime, frameRateFraction } from './frameRate';

describe('frameRateFraction — recovering the rate behind its rounding', () => {
  it('recognizes NTSC rates stored to the hundredth', () => {
    expect(frameRateFraction(23.98)).toEqual({ num: 24000, den: 1001 });
    expect(frameRateFraction(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(frameRateFraction(47.95)).toEqual({ num: 48000, den: 1001 });
    expect(frameRateFraction(59.94)).toEqual({ num: 60000, den: 1001 });
    expect(frameRateFraction(119.88)).toEqual({ num: 120000, den: 1001 });
  });

  it('never confuses an integer rate with its fractional neighbour', () => {
    expect(frameRateFraction(24)).toBeNull();
    expect(frameRateFraction(25)).toBeNull();
    expect(frameRateFraction(30)).toBeNull();
    expect(frameRateFraction(48)).toBeNull();
    expect(frameRateFraction(60)).toBeNull();
    expect(frameRateFraction(120)).toBeNull();
  });

  it('prefers the fraction read by the probe when the media carries it', () => {
    expect(frameRateFraction(23.98, { num: 24000, den: 1001 })).toEqual({ num: 24000, den: 1001 });
    // Exotic rate: only the probe can give it; rounding does not identify it.
    expect(frameRateFraction(23.98, { num: 2997, den: 125 })).toEqual({ num: 2997, den: 125 });
  });

  it('ignores an incomplete fraction and an absurd rate', () => {
    expect(frameRateFraction(24, { num: 24000 })).toBeNull();
    expect(frameRateFraction(null)).toBeNull();
    expect(frameRateFraction(0)).toBeNull();
    expect(frameRateFraction(Number.NaN)).toBeNull();
  });
});

describe('exactFrameRate', () => {
  it('corrects 23.98 to 23.976 and leaves correct rates intact', () => {
    expect(exactFrameRate(23.98)).toBe(23.976);
    expect(exactFrameRate(29.97)).toBe(29.97);
    expect(exactFrameRate(59.94)).toBe(59.94);
    expect(exactFrameRate(25)).toBe(25);
    expect(exactFrameRate(24)).toBe(24);
  });

  it('stays readable: three decimals, not seventeen', () => {
    expect(String(exactFrameRate(23.98))).toBe('23.976');
    expect(String(exactFrameRate(47.95))).toBe('47.952');
  });

  it('falls back to 24 when no rate is known', () => {
    expect(exactFrameRate(null)).toBe(24);
    expect(exactFrameRate(undefined)).toBe(24);
    expect(exactFrameRate(-5)).toBe(24);
  });
});

describe('frameAtTime — the drift that the exact rate corrects', () => {
  it('both rates give the same frame on a short shot', () => {
    expect(frameAtTime(3, 23.98)).toBe(frameAtTime(3, exactFrameRate(23.98)));
  });

  it('rounding costs a whole frame after four minutes', () => {
    const t = 251; // 1 / 0.003976 s: the gap reaches a full frame
    expect(frameAtTime(t, 23.98) - frameAtTime(t, exactFrameRate(23.98))).toBe(1);
  });

  it('the corrected rate matches the exact fraction on a seventeen-minute shot', () => {
    const t = 1020;
    const truth = Math.round((t * 24000) / 1001);
    expect(frameAtTime(t, exactFrameRate(23.98))).toBe(truth);
    // Without correction, four frames off: the round trip no longer points to the right image.
    expect(frameAtTime(t, 23.98) - truth).toBe(4);
  });

  it('clamps inconsistent inputs to frame zero', () => {
    expect(frameAtTime(-1, 24)).toBe(0);
    expect(frameAtTime(Number.NaN, 24)).toBe(0);
    expect(frameAtTime(10, 0)).toBe(0);
  });
});
