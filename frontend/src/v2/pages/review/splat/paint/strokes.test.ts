// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DEFAULT_STROKE_PX, MAX_STROKE_PX, MIN_STROKE_PX, clampStrokeWidth, decodeStrokes } from './strokes';

/**
 * `strokeRadius` disappeared with the tube in world units: the thickness is now a number of
 * screen pixels, kept by `LineMaterial`, and there is no radius left to derive from the scene
 * size. The test that locked in this proportionality is therefore replaced, knowingly, by the
 * one for the only normalization that remains: the thickness bounds.
 */
describe('clampStrokeWidth', () => {
  it('bounds the read-back thickness and falls back to the default if unreadable', () => {
    expect(clampStrokeWidth(0)).toBe(MIN_STROKE_PX);
    expect(clampStrokeWidth(1000)).toBe(MAX_STROKE_PX);
    expect(clampStrokeWidth(4)).toBe(4);
    expect(clampStrokeWidth(undefined)).toBe(DEFAULT_STROKE_PX);
    expect(clampStrokeWidth(Number.NaN)).toBe(DEFAULT_STROKE_PX);
    expect(clampStrokeWidth('3')).toBe(DEFAULT_STROKE_PX);
  });
});

describe('decodeStrokes', () => {
  it('extracts the valid strokes from a mixed annotation array (hotspot + 2D + strokes)', () => {
    const annotation = [
      { type: 'hotspot', position: '0 0 0', normal: '0 0 1' },
      { type: 'pen', points: [[0, 0]] },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#ff0000', width: 2 },
      { type: 'splat-paint', points: [0, 0, 0], color: '#00ff00', width: 1 }, // too short
      { type: 'splat-paint', points: [0, 0, 0, 1, NaN, 1], color: '#0000ff', width: 1 }, // NaN
      { type: 'splat-paint', points: [0, 0, 0, 1, 1], color: '#0000ff', width: 1 }, // not a multiple of 3
    ];
    const strokes = decodeStrokes(annotation);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].color).toBe('#ff0000');
    expect(strokes[0].width).toBe(2);
  });

  it('tolerates non-array annotations (null, object, string)', () => {
    expect(decodeStrokes(null)).toEqual([]);
    expect(decodeStrokes({ type: 'splat-paint' })).toEqual([]);
    expect(decodeStrokes('x')).toEqual([]);
  });

  it('normalizes the thickness of a read-back stroke: it can be neither zero nor excessive', () => {
    const [thin, fat] = decodeStrokes([
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 0 },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 900 },
    ]);
    expect(thin.width).toBe(MIN_STROKE_PX);
    expect(fat.width).toBe(MAX_STROKE_PX);
  });

  it('keeps a usable normal and discards one that is not', () => {
    const [kept, dropped, malformed] = decodeStrokes([
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 2, normal: [0, 0, 1] },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 2, normal: [0, 0] },
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#fff', width: 2, normal: 'x' },
    ]);
    expect(kept.normal).toEqual([0, 0, 1]);
    expect(dropped.normal).toBeUndefined();
    expect(malformed.normal).toBeUndefined();
  });

  it('accepts a stroke from before the normal: it stays readable as is', () => {
    const [stroke] = decodeStrokes([
      { type: 'splat-paint', points: [0, 0, 0, 1, 1, 1], color: '#abcdef', width: 3 },
    ]);
    expect(stroke.normal).toBeUndefined();
    expect(stroke.points).toEqual([0, 0, 0, 1, 1, 1]);
  });
});
