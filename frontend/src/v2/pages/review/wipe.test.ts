// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { wipeAngleFromPoint, wipeCenter, wipeClipPoints, wipePosFromPoint } from './wipe';

const area = (pts: [number, number][]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

describe('wipeClipPoints', () => {
  it('vertical bar at the centre → right half', () => {
    const pts = wipeClipPoints(0.5, 0, 1000, 500);
    expect(area(pts)).toBeCloseTo(0.5, 6);
    // All points are in the right half.
    expect(pts.every(([x]) => x >= 0.5 - 1e-9)).toBe(true);
  });

  it('horizontal bar (90°) at the centre → bottom half', () => {
    const pts = wipeClipPoints(0.5, 90, 800, 600);
    expect(area(pts)).toBeCloseTo(0.5, 6);
    expect(pts.every(([, y]) => y >= 0.5 - 1e-9)).toBe(true);
  });

  it('pos 0 → everything visible, pos 1 → nothing', () => {
    expect(area(wipeClipPoints(0, 0, 640, 480))).toBeCloseTo(1, 6);
    expect(area(wipeClipPoints(1, 0, 640, 480))).toBeCloseTo(0, 6);
  });

  it('diagonal bar: valid polygon covering about half', () => {
    const pts = wipeClipPoints(0.5, 45, 1000, 1000);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(area(pts)).toBeCloseTo(0.5, 3);
  });
});

describe('wipePosFromPoint / wipeCenter (round trip)', () => {
  it('projection consistent with the centre', () => {
    for (const angle of [0, 30, 90, -60]) {
      const [cx, cy] = wipeCenter(0.7, angle, 1200, 700);
      expect(wipePosFromPoint(cx, cy, angle, 1200, 700)).toBeCloseTo(0.7, 6);
    }
  });
  it('clamps the result to [0,1]', () => {
    expect(wipePosFromPoint(-5000, 0, 0, 800, 600)).toBe(0);
    expect(wipePosFromPoint(5000, 0, 0, 800, 600)).toBe(1);
  });
});

describe('wipeAngleFromPoint', () => {
  it('handle above the centre → 0° (vertical bar), snapped', () => {
    expect(wipeAngleFromPoint(500, 200, 500, 400)).toBe(0);
    // Slightly offset (< 3°) → snapped to 0.
    expect(wipeAngleFromPoint(505, 200, 500, 400)).toBe(0);
  });
  it('handle to the right of the centre → 90° (horizontal bar)', () => {
    expect(wipeAngleFromPoint(700, 400, 500, 400)).toBe(90);
  });
});
