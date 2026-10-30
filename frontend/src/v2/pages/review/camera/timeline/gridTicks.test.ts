// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { niceStep, niceTicks } from './gridTicks';

describe('gridTicks', () => {
  it('niceStep rounds to the 1/2/5 × 10ⁿ series', () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(120)).toBe(200);
    expect(niceStep(0.03)).toBeCloseTo(0.05);
  });

  it('niceStep is robust to invalid inputs', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });

  it('niceTicks covers the interval with round values', () => {
    const ticks = niceTicks(0, 1000, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(1000);
    // regular step
    expect(ticks[1] - ticks[0]).toBe(ticks[2] - ticks[1]);
  });

  it('niceTicks is empty for a degenerate interval', () => {
    expect(niceTicks(5, 5)).toEqual([]);
    expect(niceTicks(10, 0)).toEqual([]);
  });
});
