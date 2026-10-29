// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { applyLod, createAutoLod } from './lod';

describe('createAutoLod (state machine 15 fps / 5 s + hysteresis)', () => {
  it('engages after 5 s below 15 fps, not before', () => {
    const auto = createAutoLod();
    for (let i = 0; i < 9; i++) expect(auto.step(10, 500)).toBe(false); // 4.5 s
    expect(auto.step(10, 500)).toBe(true); // 5 s
    expect(auto.engaged).toBe(true);
  });

  it('a one-off return above the threshold resets the counter', () => {
    const auto = createAutoLod();
    for (let i = 0; i < 8; i++) auto.step(10, 500);
    auto.step(30, 500); // respite → counter reset to zero
    for (let i = 0; i < 9; i++) expect(auto.step(10, 500)).toBe(false);
    expect(auto.step(10, 500)).toBe(true);
  });

  it('hysteresis: only disengages above 25 fps for 5 s (no flicker at 20 fps)', () => {
    const auto = createAutoLod();
    for (let i = 0; i < 10; i++) auto.step(10, 500);
    expect(auto.engaged).toBe(true);
    // 20 fps (between 15 and 25): stays engaged indefinitely.
    for (let i = 0; i < 30; i++) expect(auto.step(20, 500)).toBe(true);
    // 30 fps for 5 s: disengaged.
    for (let i = 0; i < 9; i++) expect(auto.step(30, 500)).toBe(true);
    expect(auto.step(30, 500)).toBe(false);
  });
});

describe('applyLod', () => {
  it('sets enableLod/enableLodFetching according to the mode', () => {
    const spark = { enableLod: false, enableLodFetching: false };
    applyLod(spark, true, true);
    expect(spark).toEqual({ enableLod: true, enableLodFetching: true });
    applyLod(spark, false, false);
    expect(spark).toEqual({ enableLod: false, enableLodFetching: false });
  });
});
