// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * View transform of the curve editor (Phase 17): pure time↔pixel mapping (X axis, shared by the
 * dopesheet and the graph) and value↔pixel mapping (Y axis, graph editor), with zoom/pan.
 * Testable without DOM.
 */

/** Horizontal view (time): `t0`/`t1` = visible bounds in ms, `width` = plot width in px. */
export interface TimeView {
  t0: number;
  t1: number;
  width: number;
}

/** Vertical view (value) of the graph editor: `v0`/`v1` visible bounds, `height` = height in px. */
export interface ValueView {
  v0: number;
  v1: number;
  height: number;
}

export const timeToX = (t: number, view: TimeView): number =>
  view.t1 === view.t0 ? 0 : ((t - view.t0) / (view.t1 - view.t0)) * view.width;

export const xToTime = (x: number, view: TimeView): number =>
  view.t0 + (x / (view.width || 1)) * (view.t1 - view.t0);

// Y is inverted (high value = high pixel).
export const valueToY = (v: number, view: ValueView): number =>
  view.v1 === view.v0 ? view.height / 2 : ((view.v1 - v) / (view.v1 - view.v0)) * view.height;

export const yToValue = (y: number, view: ValueView): number =>
  view.v1 - (y / (view.height || 1)) * (view.v1 - view.v0);

/** Horizontal zoom centered on time `pivotT` (wheel) — `factor` < 1 = zoom in. */
export function zoomTime(view: TimeView, pivotT: number, factor: number): TimeView {
  const t0 = pivotT - (pivotT - view.t0) * factor;
  const t1 = pivotT + (view.t1 - pivotT) * factor;
  return { ...view, t0, t1: Math.max(t1, t0 + 1) };
}

/** Shifts the time window by `deltaMs` (pan). */
export const panTime = (view: TimeView, deltaMs: number): TimeView => ({
  ...view,
  t0: view.t0 + deltaMs,
  t1: view.t1 + deltaMs,
});

/** Minimum extent of the value axis — a channel in radians can be zoomed very far. */
const MIN_VALUE_SPAN = 1e-6;

/** Vertical zoom centered on value `pivotV` (Ctrl+wheel) — `factor` < 1 = zoom in. */
export function zoomValue(view: ValueView, pivotV: number, factor: number): ValueView {
  const v0 = pivotV - (pivotV - view.v0) * factor;
  const v1 = pivotV + (view.v1 - pivotV) * factor;
  return { ...view, v0, v1: Math.max(v1, v0 + MIN_VALUE_SPAN) };
}

/** Shifts the value window by `deltaV` (vertical pan). */
export const panValue = (view: ValueView, deltaV: number): ValueView => ({
  ...view,
  v0: view.v0 + deltaV,
  v1: view.v1 + deltaV,
});

/**
 * Position (%) of a time on a fixed-width track (transport), **clamped to the track**.
 *
 * Without this clamp, a time beyond the duration (scrubbing far along the timeline, or playback
 * past the loop by one frame) placed the playhead at `left: 400%`: it left its track, and the
 * transport — which scrolls with `overflow-x: auto` — gained a horizontal scrollbar.
 */
export function trackPct(t: number, span: number): number {
  if (!(span > 0)) return 0;
  return Math.min(100, Math.max(0, (t / span) * 100));
}

/** Rounds a time (ms) to the nearest frame at the pipeline frame rate. */
export function snapToFrame(ms: number, fps: number): number {
  if (!(fps > 0)) return Math.max(0, ms);
  const frameMs = 1000 / fps;
  return Math.max(0, Math.round(ms / frameMs) * frameMs);
}

/** Short `s:ff` timecode (seconds:frame) — the ruler and transport display. */
export function timecode(ms: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 24;
  const frames = Math.round((Math.max(0, ms) / 1000) * safeFps);
  const whole = Math.round(safeFps);
  const s = Math.floor(frames / whole);
  const ff = frames % whole;
  return `${s}:${String(ff).padStart(2, '0')}`;
}

/** Time ruler ticks: `major` labelled (timecode), `minor` = frames/subdivisions. */
export interface RulerTicks {
  major: Array<{ t: number; label: string }>;
  minor: number[];
}

/**
 * Adaptive ruler ticks: a labelled step ≥ ~70 px, picked as round numbers of frames (1/2/5/10)
 * then of seconds (1/2/5/10/30/60…); minor ticks per frame when it stays readable (≥ 6 px),
 * otherwise a fifth of the step.
 */
export function rulerTicks(view: TimeView, fps: number): RulerTicks {
  const safeFps = fps > 0 ? fps : 24;
  const span = view.t1 - view.t0;
  if (!(span > 0) || !(view.width > 0)) return { major: [], minor: [] };
  const pxPerMs = view.width / span;
  const frameMs = 1000 / safeFps;
  const stepMs =
    [1, 2, 5, 10].map((n) => n * frameMs).find((s) => s * pxPerMs >= 70) ??
    [1, 2, 5, 10, 30, 60, 120, 300, 600].map((n) => n * 1000).find((s) => s * pxPerMs >= 70) ??
    600_000;
  const minorStep = frameMs * pxPerMs >= 6 ? frameMs : stepMs / 5 >= 6 / pxPerMs ? stepMs / 5 : 0;

  const major: RulerTicks['major'] = [];
  const start = Math.max(0, Math.ceil(view.t0 / stepMs) * stepMs);
  for (let t = start; t <= view.t1 && major.length < 500; t += stepMs)
    major.push({ t, label: timecode(t, safeFps) });

  const minor: number[] = [];
  if (minorStep > 0) {
    const m0 = Math.max(0, Math.ceil(view.t0 / minorStep) * minorStep);
    for (let t = m0; t <= view.t1 && minor.length < 2000; t += minorStep)
      if (Math.abs(t / stepMs - Math.round(t / stepMs)) > 1e-6) minor.push(t);
  }
  return { major, minor };
}

/** Value bounds enclosing a series (with a 10% margin), symmetric fallback if constant. */
export function fitValueRange(values: number[]): { v0: number; v1: number } {
  if (values.length === 0) return { v0: -1, v1: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.1;
  return { v0: min - pad, v1: max + pad };
}
