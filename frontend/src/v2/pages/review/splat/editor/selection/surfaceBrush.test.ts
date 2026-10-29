// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { collectBrushHits, depthBand } from './surfaceBrush';

// Clip matrix: x/y pass through as-is, w = z (seen depth), cz forced to 0 (inside the frustum).
const DEPTH_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
const VIEWPORT = { width: 100, height: 100 };
const NONE = () => false;

describe('collectBrushHits', () => {
  it('takes surface splats (depth band) and ignores those traversed behind', () => {
    // 3 splats aligned at the screen centre: z=1 (surface), z=1.2 (in the band), z=3 (behind).
    // x/y multiplied by w at projection, so x=0 stays at the centre whatever z.
    const centers = new Float32Array([0, 0, 1, 0, 0, 1.2, 0, 0, 3]);
    const hits = collectBrushHits(
      DEPTH_MATRIX,
      centers,
      NONE,
      VIEWPORT,
      { x: 50, y: 50, radiusPx: 10 },
      { viewZ: 1, halfDepth: 0.3 },
    );
    expect(hits).toEqual([0, 1]);
  });

  it('respects the brush screen disc and the hidden filter', () => {
    // z=1 everywhere → screen: (50,50) and (75,50); brush r=10 at (50,50) only takes the 1st.
    const centers = new Float32Array([0, 0, 1, 0.5, 0, 1]);
    const brush = { x: 50, y: 50, radiusPx: 10 };
    const band = { viewZ: 1, halfDepth: 0.5 };
    expect(collectBrushHits(DEPTH_MATRIX, centers, NONE, VIEWPORT, brush, band)).toEqual([0]);
    expect(collectBrushHits(DEPTH_MATRIX, centers, (i) => i === 0, VIEWPORT, brush, band)).toEqual([]);
    // Enlarged radius: both.
    expect(collectBrushHits(DEPTH_MATRIX, centers, NONE, VIEWPORT, { ...brush, radiusPx: 30 }, band)).toEqual(
      [0, 1],
    );
  });

  it('excludes centres behind the camera (w ≤ 0)', () => {
    const centers = new Float32Array([0, 0, -1]);
    expect(
      collectBrushHits(
        DEPTH_MATRIX,
        centers,
        NONE,
        VIEWPORT,
        { x: 50, y: 50, radiusPx: 50 },
        { viewZ: 1, halfDepth: 5 },
      ),
    ).toEqual([]);
  });
});

describe('depthBand', () => {
  it('grows with depth but stays independent of the radius (no longer drills)', () => {
    const near = depthBand(1);
    const far = depthBand(10);
    expect(far).toBeCloseTo(near * 10); // proportional to depth
    expect(near).toBeGreaterThan(0);
    // Fixed fraction of the depth: a "large brush" does not change the thickness.
    expect(depthBand(1, 0.03)).toBeCloseTo(0.03);
  });
});
