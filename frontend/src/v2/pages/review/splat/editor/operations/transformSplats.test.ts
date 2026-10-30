// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { centroidOfCenters } from './transformSplats';

describe('centroidOfCenters', () => {
  it('averages the centres of the selected batch', () => {
    // 3 splats: (0,0,0), (2,0,0), (4,0,0): barycentre of indices 0 and 2 = (2,0,0).
    const centers = new Float32Array([0, 0, 0, 2, 0, 0, 4, 0, 0]);
    expect(centroidOfCenters(centers, [0, 2])).toEqual([2, 0, 0]);
  });

  it('full 3D barycentre', () => {
    const centers = new Float32Array([1, 1, 1, 3, 5, 7]);
    expect(centroidOfCenters(centers, [0, 1])).toEqual([2, 3, 4]);
  });

  it('empty batch → origin', () => {
    expect(centroidOfCenters(new Float32Array([1, 2, 3]), [])).toEqual([0, 0, 0]);
  });
});
