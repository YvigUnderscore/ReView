// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  clampScale,
  isFit,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  wheelFactor,
  zoomBy,
  zoomStyle,
  zoomTo,
  ZOOM_FIT,
} from './viewportZoom';

/** Screen position (relative to the centre) of a layer point, under the transform. */
const project = (state: { scale: number; x: number; y: number }, local: number) =>
  local * state.scale + state.x;

describe('zoomTo', () => {
  it('keeps the point under the cursor fixed', () => {
    const before = { scale: 1, x: 0, y: 0 };
    // Layer point located 120 px from the centre: it is at 120 px on screen before zoom.
    const local = 120;
    const after = zoomTo(before, 4, project(before, local), 0);
    expect(project(after, local)).toBeCloseTo(120, 6);
  });

  it('zoom at the centre: the centre does not move', () => {
    const after = zoomTo(ZOOM_FIT, 3, 0, 0);
    expect(after).toEqual({ scale: 3, x: 0, y: 0 });
  });

  it('clamps the scale and returns the state unchanged when the bound is reached', () => {
    const maxed = zoomTo(ZOOM_FIT, 1000, 50, 50);
    expect(maxed.scale).toBe(MAX_SCALE);
    expect(zoomTo(maxed, 1000, 50, 50)).toBe(maxed);
    expect(zoomTo(ZOOM_FIT, 0, 0, 0).scale).toBe(MIN_SCALE);
  });
});

describe('zoomBy / panBy', () => {
  it('chains wheel notches without drifting from the targeted point', () => {
    let s = ZOOM_FIT;
    const local = -80;
    for (let i = 0; i < 5; i++) s = zoomBy(s, wheelFactor(-1), project(s, local), 0);
    expect(s.scale).toBeGreaterThan(1.9);
    expect(project(s, local)).toBeCloseTo(-80, 6);
  });

  it('pan is a simple screen offset', () => {
    expect(panBy({ scale: 2, x: 10, y: -5 }, 4, 6)).toEqual({ scale: 2, x: 14, y: 1 });
  });

  it('the wheel down zooms out', () => {
    expect(wheelFactor(120)).toBeLessThan(1);
    expect(wheelFactor(-120)).toBeGreaterThan(1);
  });
});

describe('zoomStyle / isFit', () => {
  it('fitted: no style, the render stays as it was before the zoom', () => {
    expect(isFit(ZOOM_FIT)).toBe(true);
    expect(zoomStyle(ZOOM_FIT)).toEqual({});
  });

  it('zoomed: centred transform', () => {
    const style = zoomStyle({ scale: 2, x: 3, y: -4 });
    expect(style.transform).toBe('translate(3px, -4px) scale(2)');
    expect(style.transformOrigin).toBe('center center');
  });

  it('panned without zoom: the view is no longer fitted', () => {
    expect(isFit({ scale: 1, x: 12, y: 0 })).toBe(false);
  });
});

describe('clampScale', () => {
  it('rejects non-finite values', () => {
    expect(clampScale(Number.NaN)).toBe(1);
  });
});
