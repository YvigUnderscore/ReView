// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Gantt geometry: pure functions, outside React, tested.
 *
 * The defect fixed here was visible on screen: the bar of a task started before the beginning of the window was placed at a
 * **negative** percentage (`((start - min) / span) * 100` without bounding), so it was painted outside its track, over the
 * label column.
 *
 * The fix fits in one sentence: **bound the bar to the window**, not the window to the bar. An overflowing task starts at
 * the edge (`left: 0`) and says so (`clippedStart` / `clippedEnd`, from which the screen draws an unrounded edge) rather than
 * disappearing: a task running for two months must stay visible in the month's window.
 */

/** One day in milliseconds. */
export const DAY = 86_400_000;

/**
 * Minimum width of a bar, as a % of the window. A single-day task in a quarter weighs 1.1%: without a floor it is
 * not visible.
 */
export const MIN_BAR_PCT = 1.5;

/** What the geometry requires of a task: two bounds, possibly absent. */
export interface DatedTask {
  startDate: string | null;
  dueDate: string | null;
}

/** Absolute interval of a task, in milliseconds. */
export interface Bar<T> {
  task: T;
  start: number;
  end: number;
}

/** Displayed window: origin and duration. `span` is always strictly positive. */
export interface GanttWindow {
  min: number;
  span: number;
}

/** Position of a bar within the window, in %: never outside [0, 100]. */
export interface BarBox {
  left: number;
  width: number;
  /** The task starts before the window: the bar is cut on the left. */
  clippedStart: boolean;
  /** The task ends after the window: the bar is cut on the right. */
  clippedEnd: boolean;
  /** False if the task is entirely outside the window: nothing to paint. */
  visible: boolean;
}

/**
 * Interval [start, end] of a task: if one of the bounds is missing, falls back on the other; with no bound at all,
 * no bar. Two inverted bounds are straightened.
 */
export function spanOf<T extends DatedTask>(task: T): Bar<T> | null {
  const s = task.startDate ? new Date(task.startDate).getTime() : null;
  const e = task.dueDate ? new Date(task.dueDate).getTime() : null;
  if (s === null) return e === null ? null : { task, start: e, end: e };
  if (e === null) return { task, start: s, end: s };
  return e < s ? { task, start: e, end: s } : { task, start: s, end: e };
}

/** The bars touching the window, including those that overflow it. */
export function visibleBars<T>(bars: readonly Bar<T>[], from: number, to: number): Bar<T>[] {
  return bars.filter((b) => b.end >= from && b.start <= to);
}

/**
 * Window kept: the requested bounds, tightened around the data when the latter does not fill the whole period (a project
 * starting in two weeks does not deserve two weeks of emptiness on the left). `null` if there is nothing to show.
 */
export function ganttWindow(
  bars: readonly { start: number; end: number }[],
  from: number,
  to: number,
): GanttWindow | null {
  if (bars.length === 0) return null;
  const min = Math.max(from, Math.min(...bars.map((b) => b.start)));
  const max = Math.min(to, Math.max(...bars.map((b) => b.end)));
  return { min, span: Math.max(max - min, DAY) };
}

/**
 * Places a bar within the window. Everything is bounded to [0, 100]: it is here, and not in the stylesheet, that the
 * bar stops being able to leave its track.
 */
export function barBox(start: number, end: number, win: GanttWindow): BarBox {
  const span = Math.max(win.span, 1);
  const max = win.min + span;
  const clippedStart = start < win.min;
  const clippedEnd = end > max;

  // Entirely outside the window: we say so, rather than painting at the edge a bar that has nothing to do with the
  // period being read.
  if (end < win.min || start > max) {
    return { left: clippedStart ? 0 : 100 - MIN_BAR_PCT, width: 0, clippedStart, clippedEnd, visible: false };
  }

  const from = Math.max(start, win.min);
  const to = Math.min(Math.max(end, from), max);
  // The minimum width must not push the bar out of the frame: the left edge is moved back first, then the width is bounded.
  const left = Math.min(((from - win.min) / span) * 100, 100 - MIN_BAR_PCT);
  const width = Math.min(Math.max(((to - from) / span) * 100, MIN_BAR_PCT), 100 - left);
  return { left, width, clippedStart, clippedEnd, visible: true };
}

/** Axis graduations, inclusive bounds. */
export function ganttTicks(win: GanttWindow, count = 5): number[] {
  const steps = Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, i) => win.min + (win.span * i) / steps);
}

/** Position of the "today" marker, or `null` if it is outside the window. */
export function markerLeft(now: number, win: GanttWindow): number | null {
  if (now < win.min || now > win.min + win.span) return null;
  return ((now - win.min) / win.span) * 100;
}

/** A track of the Gantt: a sequence and its bars. */
export interface Group<T> {
  key: string;
  label: string;
  bars: Bar<T>[];
}

/**
 * Groups by sequence, alphabetically sorted, with the tasks without a sequence last. The bars of a track are ordered by
 * start date: one reads the track from left to right.
 */
export function groupBars<T extends { sequenceCode: string | null }>(
  bars: readonly Bar<T>[],
  noSequenceLabel: string,
): Group<T>[] {
  const byKey = new Map<string, Group<T>>();
  for (const bar of bars) {
    const key = bar.task.sequenceCode ?? '￿'; // sort: no sequence last
    const label = bar.task.sequenceCode ?? noSequenceLabel;
    const group = byKey.get(key);
    if (group) group.bars.push(bar);
    else byKey.set(key, { key, label, bars: [bar] });
  }
  const groups = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const group of groups) group.bars.sort((a, b) => a.start - b.start);
  return groups;
}
