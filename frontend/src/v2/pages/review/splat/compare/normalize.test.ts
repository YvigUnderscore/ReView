// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { normalizationFor } from './normalize';

describe('normalizationFor — unifying the A/B sizes by bbox (11.H)', () => {
  it('scale = ratio of the radii, centre realigned on the reference', () => {
    // Reference: radius 2 centred at (1, 0, 0); sibling: radius 8 centred at (4, 4, 0).
    const n = normalizationFor(2, [1, 0, 0], 8, [4, 4, 0])!;
    expect(n.scale).toBeCloseTo(0.25);
    // sibling centre × 0.25 + offset = reference centre → offset = (1-1, 0-1, 0-0)
    expect(n.offset[0]).toBeCloseTo(0);
    expect(n.offset[1]).toBeCloseTo(-1);
    expect(n.offset[2]).toBeCloseTo(0);
  });

  it('identity when both splats already share the same size and the same centre', () => {
    const n = normalizationFor(3, [0, 0, 0], 3, [0, 0, 0])!;
    expect(n.scale).toBeCloseTo(1);
    expect(n.offset).toEqual([0, 0, 0]);
  });

  it('null if a radius is degenerate (zero, negative or non-finite)', () => {
    expect(normalizationFor(0, [0, 0, 0], 2, [0, 0, 0])).toBeNull();
    expect(normalizationFor(2, [0, 0, 0], 0, [0, 0, 0])).toBeNull();
    expect(normalizationFor(NaN, [0, 0, 0], 2, [0, 0, 0])).toBeNull();
  });
});
