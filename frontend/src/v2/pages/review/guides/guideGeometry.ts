// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ACTION_SAFE_RATIO, CENTER_CROSS_RATIO, TITLE_SAFE_RATIO } from './guideStyle';

/**
 * **Pure** geometry of the composition guides, in pixels of the media box. The SVG that carries
 * them has a `viewBox` in CSS pixels of its own box: one unit = one pixel, on both axes. This is
 * what makes the centre cross square. The old overlay reasoned in percentages with
 * `preserveAspectRatio="none"`, hence in different units in X and Y: its two arms were of equal
 * length only at 1:1.
 */

export interface GuideSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Usable dimension (safeguard: an unmeasured box is zero). */
const side = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/** Rule of thirds: two verticals, two horizontals. */
export function thirdsLines(w: number, h: number): GuideSegment[] {
  const bw = side(w);
  const bh = side(h);
  return [
    { x1: bw / 3, y1: 0, x2: bw / 3, y2: bh },
    { x1: (bw * 2) / 3, y1: 0, x2: (bw * 2) / 3, y2: bh },
    { x1: 0, y1: bh / 3, x2: bw, y2: bh / 3 },
    { x1: 0, y1: (bh * 2) / 3, x2: bw, y2: (bh * 2) / 3 },
  ];
}

/**
 * **Square** centre cross: both arms have the same length, wedged on the smaller side of the
 * frame. It stays square at 1:1, at 16:9 as well as at 2.39:1, and never overflows.
 */
export function centerCrossSegments(w: number, h: number): [GuideSegment, GuideSegment] {
  const bw = side(w);
  const bh = side(h);
  const arm = Math.min(bw, bh) * CENTER_CROSS_RATIO;
  const cx = bw / 2;
  const cy = bh / 2;
  return [
    { x1: cx - arm, y1: cy, x2: cx + arm, y2: cy },
    { x1: cx, y1: cy - arm, x2: cx, y2: cy + arm },
  ];
}

/** Rectangle of a safe area (fraction of the frame), centred. */
export function safeAreaRect(w: number, h: number, ratio: number): GuideRect {
  const bw = side(w);
  const bh = side(h);
  const r = Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 1) : 1;
  // Margin derived from the retained width (and not `bw * (1 - r)`): `1000 × 0.1` gives
  // 99.999999… in floating point, and the SVG attribute carried all of that tail.
  const width = bw * r;
  const height = bh * r;
  return { x: (bw - width) / 2, y: (bh - height) / 2, width, height };
}

/** "Action" safe area (90%). */
export const actionSafeRect = (w: number, h: number): GuideRect => safeAreaRect(w, h, ACTION_SAFE_RATIO);

/** "Title" safe area (80%). */
export const titleSafeRect = (w: number, h: number): GuideRect => safeAreaRect(w, h, TITLE_SAFE_RATIO);

/**
 * Border of the delivery frame: inset by half a stroke, otherwise the outer half of the stroke
 * falls outside the SVG viewport (which clips) and the border looks twice as thin as the other
 * guides.
 */
export function outlineRect(w: number, h: number, strokeWidth: number): GuideRect {
  const half = Math.max(0, strokeWidth) / 2;
  return {
    x: half,
    y: half,
    width: Math.max(0, side(w) - strokeWidth),
    height: Math.max(0, side(h) - strokeWidth),
  };
}
