// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { tonemapToRgba } from './hdriTonemap';

describe('tonemapToRgba — admin HDRI preview', () => {
  it('produces an opaque RGBA buffer at the target size', () => {
    const src = new Float32Array(4 * 4 * 4).fill(1);
    const out = tonemapToRgba(src, 4, 4, 2, 2);
    expect(out.length).toBe(2 * 2 * 4);
    expect(out[3]).toBe(255); // opaque alpha
  });

  it('applies Reinhard + gamma (0 → 0, very bright → close to 255)', () => {
    const zero = tonemapToRgba(new Float32Array(4).fill(0), 1, 1, 1, 1);
    expect(zero[0]).toBe(0);
    const bright = tonemapToRgba(new Float32Array(4).fill(1000), 1, 1, 1, 1);
    expect(bright[0]).toBeGreaterThan(250);
    // 1.0 linear → 0.5 Reinhard → ~186 after gamma 2.2
    const mid = tonemapToRgba(new Float32Array(4).fill(1), 1, 1, 1, 1);
    expect(mid[0]).toBeGreaterThan(180);
    expect(mid[0]).toBeLessThan(195);
  });

  it('samples the source (nearest) without overflowing', () => {
    // Source 2x1: left pixel black, right pixel bright.
    const src = new Float32Array(2 * 1 * 4);
    src[4] = src[5] = src[6] = 10;
    const out = tonemapToRgba(src, 2, 1, 2, 1);
    expect(out[0]).toBe(0);
    expect(out[4]).toBeGreaterThan(200);
  });
});
