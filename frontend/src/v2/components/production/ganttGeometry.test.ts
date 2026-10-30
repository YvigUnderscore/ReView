// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  DAY,
  MIN_BAR_PCT,
  barBox,
  ganttTicks,
  ganttWindow,
  groupBars,
  markerLeft,
  spanOf,
  visibleBars,
  type GanttWindow,
} from './ganttGeometry';

/**
 * The defect seen on screen: a bar at `left: -140%`, painted over the label column. These tests lock down the invariant
 * that forbids it, nothing leaving [0, 100], and its counterpart: what overflows stays visible, and says so.
 */

/** Reference window: ten days from 10 January 2026. */
const T0 = Date.UTC(2026, 0, 10);
const win: GanttWindow = { min: T0, span: 10 * DAY };

const inside = (box: { left: number; width: number }) =>
  box.left >= 0 && box.width > 0 && box.left + box.width <= 100 + 1e-9;

describe('barBox — bounding to the window', () => {
  it('places a fully contained bar at its exact place', () => {
    const box = barBox(T0 + 2 * DAY, T0 + 4 * DAY, win);
    expect(box).toMatchObject({ left: 20, width: 20, clippedStart: false, clippedEnd: false, visible: true });
  });

  it('cuts on the left a task started before the window, instead of using a negative percentage', () => {
    const box = barBox(T0 - 30 * DAY, T0 + 3 * DAY, win);
    expect(box.left).toBe(0);
    expect(box.width).toBe(30);
    expect(box.clippedStart).toBe(true);
    expect(box.clippedEnd).toBe(false);
    expect(inside(box)).toBe(true);
  });

  it('cuts on the right a task that ends after the window', () => {
    const box = barBox(T0 + 8 * DAY, T0 + 40 * DAY, win);
    expect(box.left).toBe(80);
    expect(box.width).toBe(20);
    expect(box.clippedEnd).toBe(true);
    expect(box.clippedStart).toBe(false);
    expect(inside(box)).toBe(true);
  });

  it('covers the whole track when the task overflows on both sides', () => {
    const box = barBox(T0 - 100 * DAY, T0 + 100 * DAY, win);
    expect(box).toMatchObject({ left: 0, width: 100, clippedStart: true, clippedEnd: true, visible: true });
  });

  it('gives a single-day task at least a minimum width', () => {
    const box = barBox(T0 + 5 * DAY, T0 + 5 * DAY, win);
    expect(box.width).toBe(MIN_BAR_PCT);
    expect(box.left).toBe(50);
    expect(inside(box)).toBe(true);
  });

  it('keeps the minimum width within the frame for a task stuck to the right edge', () => {
    const box = barBox(T0 + 10 * DAY, T0 + 10 * DAY, win);
    expect(box.left).toBe(100 - MIN_BAR_PCT);
    expect(box.width).toBe(MIN_BAR_PCT);
    expect(inside(box)).toBe(true);
  });

  it('declares invisible a task entirely outside the window, with no width to paint', () => {
    const before = barBox(T0 - 40 * DAY, T0 - 30 * DAY, win);
    const after = barBox(T0 + 30 * DAY, T0 + 40 * DAY, win);
    expect(before).toMatchObject({ visible: false, width: 0, clippedStart: true });
    expect(after).toMatchObject({ visible: false, width: 0, clippedEnd: true });
    expect(before.left).toBeGreaterThanOrEqual(0);
    expect(after.left).toBeLessThanOrEqual(100);
  });

  it('never leaves the frame, whatever the bounds', () => {
    for (const startDays of [-500, -11, -1, 0, 3, 9.5, 10, 99]) {
      for (const lengthDays of [0, 0.2, 1, 7, 10, 400]) {
        const box = barBox(T0 + startDays * DAY, T0 + (startDays + lengthDays) * DAY, win);
        if (!box.visible) continue;
        expect(inside(box)).toBe(true);
      }
    }
  });

  it('supports a degenerate window without dividing by zero', () => {
    const box = barBox(T0, T0, { min: T0, span: 0 });
    expect(Number.isFinite(box.left)).toBe(true);
    expect(Number.isFinite(box.width)).toBe(true);
  });
});

describe('spanOf', () => {
  it('fills a missing bound from the other', () => {
    expect(spanOf({ startDate: '2026-01-10T00:00:00.000Z', dueDate: null })).toMatchObject({
      start: T0,
      end: T0,
    });
    expect(spanOf({ startDate: null, dueDate: '2026-01-10T00:00:00.000Z' })).toMatchObject({
      start: T0,
      end: T0,
    });
  });

  it('renders nothing without any date', () => {
    expect(spanOf({ startDate: null, dueDate: null })).toBeNull();
  });

  it('straightens two inverted bounds', () => {
    const bar = spanOf({ startDate: '2026-01-20T00:00:00.000Z', dueDate: '2026-01-10T00:00:00.000Z' });
    expect(bar?.start).toBe(T0);
    expect(bar?.end).toBe(Date.UTC(2026, 0, 20));
  });
});

describe('ganttWindow and tick marks', () => {
  const bars = [
    { start: T0 - 50 * DAY, end: T0 + 2 * DAY },
    { start: T0 + 1 * DAY, end: T0 + 5 * DAY },
  ];

  it('keeps the requested bounds when the data overflows them', () => {
    const w = ganttWindow(bars, T0, T0 + 10 * DAY);
    expect(w).toEqual({ min: T0, span: 5 * DAY });
  });

  it('tightens around the data when it does not fill the period', () => {
    const w = ganttWindow([{ start: T0 + 2 * DAY, end: T0 + 4 * DAY }], T0, T0 + 30 * DAY);
    expect(w).toEqual({ min: T0 + 2 * DAY, span: 2 * DAY });
  });

  it('keeps a non-zero duration for a single day', () => {
    expect(ganttWindow([{ start: T0, end: T0 }], T0, T0)?.span).toBe(DAY);
  });

  it('renders nothing without a bar', () => {
    expect(ganttWindow([], T0, T0 + DAY)).toBeNull();
  });

  it('produces ticks with inclusive bounds', () => {
    expect(ganttTicks(win)).toEqual([T0, T0 + 2.5 * DAY, T0 + 5 * DAY, T0 + 7.5 * DAY, T0 + 10 * DAY]);
  });

  it('places the day marker only within the window', () => {
    expect(markerLeft(T0 + 5 * DAY, win)).toBe(50);
    expect(markerLeft(T0 - DAY, win)).toBeNull();
    expect(markerLeft(T0 + 11 * DAY, win)).toBeNull();
  });
});

describe('visibleBars et groupBars', () => {
  it('keeps the bars that overflow and discards those elsewhere', () => {
    const bars = [
      { task: { sequenceCode: 'SQ01' }, start: T0 - 40 * DAY, end: T0 + DAY },
      { task: { sequenceCode: 'SQ01' }, start: T0 - 40 * DAY, end: T0 - 20 * DAY },
    ];
    expect(visibleBars(bars, T0, T0 + 10 * DAY)).toHaveLength(1);
  });

  it('puts the ones without a sequence last and orders each track', () => {
    const bars: { task: { sequenceCode: string | null }; start: number; end: number }[] = [
      { task: { sequenceCode: null }, start: T0, end: T0 },
      { task: { sequenceCode: 'SQ02' }, start: T0 + 5 * DAY, end: T0 + 6 * DAY },
      { task: { sequenceCode: 'SQ02' }, start: T0 + DAY, end: T0 + 2 * DAY },
    ];
    const groups = groupBars(bars, 'No sequence');
    expect(groups.map((g) => g.label)).toEqual(['SQ02', 'No sequence']);
    expect(groups[0].bars.map((b) => b.start)).toEqual([T0 + DAY, T0 + 5 * DAY]);
  });
});
