// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  fitValueRange,
  panTime,
  panValue,
  rulerTicks,
  snapToFrame,
  timecode,
  timeToX,
  trackPct,
  xToTime,
  valueToY,
  yToValue,
  zoomTime,
  zoomValue,
} from './viewTransform';

describe('viewTransform — time ↔ pixel', () => {
  const view = { t0: 0, t1: 1000, width: 200 };
  it('maps and inverts time', () => {
    expect(timeToX(500, view)).toBe(100);
    expect(xToTime(100, view)).toBe(500);
    expect(timeToX(0, view)).toBe(0);
    expect(timeToX(1000, view)).toBe(200);
  });
});

describe('viewTransform — value ↔ pixel (inverted Y)', () => {
  const view = { v0: 0, v1: 10, height: 100 };
  it('high value = high pixel', () => {
    expect(valueToY(10, view)).toBe(0);
    expect(valueToY(0, view)).toBe(100);
    expect(yToValue(0, view)).toBe(10);
    expect(yToValue(100, view)).toBe(0);
  });
});

describe('viewTransform — zoom/pan', () => {
  it('zoomTime in (factor<1) tightens around the pivot', () => {
    const z = zoomTime({ t0: 0, t1: 1000, width: 200 }, 500, 0.5);
    expect(z.t0).toBe(250);
    expect(z.t1).toBe(750);
  });
  it('panTime shifts the window', () => {
    const p = panTime({ t0: 0, t1: 1000, width: 200 }, 100);
    expect(p.t0).toBe(100);
    expect(p.t1).toBe(1100);
  });

  it('zoomValue tightens the value axis around the pivot', () => {
    const z = zoomValue({ v0: 0, v1: 10, height: 100 }, 5, 0.5);
    expect(z.v0).toBe(2.5);
    expect(z.v1).toBe(7.5);
  });

  it('zoomValue keeps a non-zero extent even at the extreme', () => {
    const z = zoomValue({ v0: 0, v1: 10, height: 100 }, 5, 0);
    expect(z.v1).toBeGreaterThan(z.v0);
  });

  it('panValue shifts the value window', () => {
    const p = panValue({ v0: 0, v1: 10, height: 100 }, -2);
    expect(p.v0).toBe(-2);
    expect(p.v1).toBe(8);
  });
});

describe('trackPct — playhead clamped to its track', () => {
  it('stays within [0, 100] whatever the time', () => {
    expect(trackPct(500, 1000)).toBe(50);
    expect(trackPct(0, 1000)).toBe(0);
    expect(trackPct(1000, 1000)).toBe(100);
    // Beyond the duration, the head overflowed the track and made a scrollbar appear.
    expect(trackPct(60_000, 1000)).toBe(100);
    expect(trackPct(-200, 1000)).toBe(0);
  });

  it('a zero duration does not divide by zero', () => {
    expect(trackPct(42, 0)).toBe(0);
  });
});

describe('snapToFrame / timecode', () => {
  it('rounds to the nearest frame (24 fps)', () => {
    const frameMs = 1000 / 24;
    expect(snapToFrame(0, 24)).toBe(0);
    expect(snapToFrame(frameMs * 3 + 5, 24)).toBeCloseTo(frameMs * 3, 6);
    expect(snapToFrame(frameMs * 3.6, 24)).toBeCloseTo(frameMs * 4, 6);
    expect(snapToFrame(-50, 24)).toBe(0);
  });
  it('invalid fps: clamped to zero without snap', () => {
    expect(snapToFrame(123, 0)).toBe(123);
  });
  it('timecode s:ff', () => {
    expect(timecode(0, 24)).toBe('0:00');
    expect(timecode(1000, 24)).toBe('1:00');
    expect(timecode(1000 + 500, 24)).toBe('1:12');
    expect(timecode((1000 / 24) * 30, 24)).toBe('1:06');
  });
});

describe('rulerTicks', () => {
  it('step labelled in round frames when the frame is wide', () => {
    // 2 s over 2000 px at 24 fps: 1 frame ≈ 41.7 px → step of 2 frames (≥ 70 px), minor ticks per frame.
    const ticks = rulerTicks({ t0: 0, t1: 2000, width: 2000 }, 24);
    expect(ticks.major[0]).toEqual({ t: 0, label: '0:00' });
    const stepMs = ticks.major[1].t - ticks.major[0].t;
    expect(stepMs).toBeCloseTo((1000 / 24) * 2, 6);
    expect(ticks.minor.length).toBeGreaterThan(0);
    // Minor ticks do not duplicate the major ones.
    for (const m of ticks.minor) expect(ticks.major.some((M) => Math.abs(M.t - m) < 1e-6)).toBe(false);
  });
  it('step labelled in seconds when the window is wide', () => {
    // 60 s over 600 px: 1 s = 10 px → step of 10 s.
    const ticks = rulerTicks({ t0: 0, t1: 60_000, width: 600 }, 24);
    const stepMs = ticks.major[1].t - ticks.major[0].t;
    expect(stepMs).toBe(10_000);
  });
  it('empty window or zero width: no tick', () => {
    expect(rulerTicks({ t0: 0, t1: 0, width: 100 }, 24)).toEqual({ major: [], minor: [] });
    expect(rulerTicks({ t0: 0, t1: 1000, width: 0 }, 24)).toEqual({ major: [], minor: [] });
  });
});

describe('fitValueRange', () => {
  it('encloses with a margin and handles a constant series', () => {
    expect(fitValueRange([0, 10])).toEqual({ v0: -1, v1: 11 });
    const c = fitValueRange([5, 5]);
    expect(c.v0).toBeLessThan(5);
    expect(c.v1).toBeGreaterThan(5);
  });
});
