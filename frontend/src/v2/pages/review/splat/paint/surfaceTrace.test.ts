// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  breaksRun,
  distanceToSegment,
  flattenObject,
  pickStroke,
  runNormal,
  strokeCenter,
  worldPerPixel,
  type Projector,
  type SurfaceSample,
} from './surfaceTrace';

const sample = (
  world: [number, number, number],
  depth: number,
  screenStep = 6,
  toCamera: [number, number, number] = [0, 0, 1],
): SurfaceSample => ({ world, object: world, depth, screenStep, toCamera });

const VIEW = { fovDeg: 50, height: 1000 };

describe('worldPerPixel', () => {
  it('grows with depth and shrinks when the view is higher', () => {
    const near = worldPerPixel(10, 50, 1000);
    expect(near).toBeCloseTo((2 * Math.tan((50 * Math.PI) / 360) * 10) / 1000, 6);
    expect(worldPerPixel(20, 50, 1000)).toBeCloseTo(near * 2, 6);
    expect(worldPerPixel(10, 50, 2000)).toBeCloseTo(near / 2, 6);
  });

  it('never returns a division by zero', () => {
    expect(Number.isFinite(worldPerPixel(0, 0, 0))).toBe(true);
  });
});

describe('breaksRun — the straight rope above a hole', () => {
  it('lets through a displacement compatible with the screen step', () => {
    const a = sample([0, 0, 0], 10);
    const b = sample([0.05, 0, 0], 10);
    expect(breaksRun(a, b, VIEW)).toBe(false);
  });

  it('cuts a disproportionate jump, even at equal depth', () => {
    const a = sample([0, 0, 0], 10);
    const b = sample([1, 0, 0], 10);
    expect(breaksRun(a, b, VIEW)).toBe(true);
  });

  it('judges on the nearest depth: a leap towards the background does not justify itself', () => {
    const near = sample([0, 0, 0], 2);
    const far = sample([0, 0, 60], 60);
    expect(breaksRun(near, far, VIEW)).toBe(true);
  });

  it('tolerates a slow gesture: a one-pixel screen step keeps a non-zero threshold', () => {
    const a = sample([0, 0, 0], 10);
    const b = sample([0.0005, 0, 0], 10, 0);
    expect(breaksRun(a, b, VIEW)).toBe(false);
  });
});

describe('runNormal', () => {
  it('averages the point → camera directions and normalizes', () => {
    const n = runNormal([sample([0, 0, 0], 5, 6, [1, 0, 0]), sample([0, 0, 0], 5, 6, [0, 1, 0])]);
    expect(n).not.toBeNull();
    expect(n![0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(n![1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(n![2]).toBeCloseTo(0, 6);
  });

  it('returns null when the average cancels out (no usable orientation)', () => {
    expect(runNormal([])).toBeNull();
    expect(runNormal([sample([0, 0, 0], 1, 6, [1, 0, 0]), sample([0, 0, 0], 1, 6, [-1, 0, 0])])).toBeNull();
  });
});

describe('flattenObject / strokeCenter', () => {
  it('flattens the object coordinates in the order of the gesture', () => {
    expect(flattenObject([sample([1, 2, 3], 1), sample([4, 5, 6], 1)])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('centre = average of the points, and [0,0,0] on an empty stroke', () => {
    expect(strokeCenter([0, 0, 0, 2, 2, 2])).toEqual([1, 1, 1]);
    expect(strokeCenter([])).toEqual([0, 0, 0]);
  });
});

describe('distanceToSegment', () => {
  it('measures the perpendicular, and the endpoints when the projection leaves the segment', () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBeCloseTo(3, 6);
    expect(distanceToSegment([-4, 0], [0, 0], [10, 0])).toBeCloseTo(4, 6);
    expect(distanceToSegment([0, 5], [0, 0], [0, 0])).toBeCloseTo(5, 6);
  });
});

describe('pickStroke — the stroke under the eraser', () => {
  // Test projector: (x, y) as-is, and nothing behind the camera (z > 0).
  const project: Projector = (x, y, z) => (z > 0 ? null : [x, y]);
  const strokes = [
    { points: [0, 0, 0, 100, 0, 0] }, // stroke A, horizontal at y = 0
    { points: [0, 50, 0, 100, 50, 0] }, // stroke B, horizontal at y = 50
  ];

  it('picks the stroke closest to the click', () => {
    expect(pickStroke(strokes, [50, 3], project)).toBe(0);
    expect(pickStroke(strokes, [50, 47], project)).toBe(1);
  });

  it('picks nothing beyond the tolerance', () => {
    expect(pickStroke(strokes, [50, 25], project)).toBeNull();
  });

  it('ignores points behind the camera without joining what frames them', () => {
    // Two visible endpoints separated by a point behind: no segment should be
    // rebuilt between them, otherwise the eraser would bite into a stroke that is not on screen.
    const split = [{ points: [0, 0, 0, 50, 0, 1, 100, 0, 0] }];
    expect(pickStroke(split, [50, 0], project)).toBeNull();
    expect(pickStroke(split, [0, 2], project)).toBe(0);
  });

  it('a long stroke does not win just because it is long', () => {
    const long = [{ points: [0, 40, 0, 1000, 40, 0] }, { points: [48, 0, 0, 52, 0, 0] }];
    expect(pickStroke(long, [50, 2], project)).toBe(1);
  });
});
