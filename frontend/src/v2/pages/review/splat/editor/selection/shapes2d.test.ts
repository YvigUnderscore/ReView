// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { combineSelection, normalizeRect, pointInPolygon, pointInRect, shapePredicate } from './shapes2d';

describe('normalizeRect', () => {
  it('normalizes a drag in any direction', () => {
    expect(normalizeRect(10, 10, 30, 40)).toEqual({ x: 10, y: 10, w: 20, h: 30 });
    expect(normalizeRect(30, 40, 10, 10)).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });
});

describe('pointInRect', () => {
  const r = { x: 10, y: 10, w: 20, h: 20 };
  it('includes the interior and the edges', () => {
    expect(pointInRect(15, 15, r)).toBe(true);
    expect(pointInRect(10, 10, r)).toBe(true);
    expect(pointInRect(30, 30, r)).toBe(true);
  });
  it('excludes the exterior', () => {
    expect(pointInRect(9, 15, r)).toBe(false);
    expect(pointInRect(15, 31, r)).toBe(false);
  });
});

describe('pointInPolygon', () => {
  const triangle: [number, number][] = [
    [0, 0],
    [10, 0],
    [5, 10],
  ];
  it('detects a point in a triangle', () => {
    expect(pointInPolygon(5, 3, triangle)).toBe(true);
    expect(pointInPolygon(1, 8, triangle)).toBe(false);
  });
  it('rejects a degenerate polygon (< 3 points)', () => {
    expect(pointInPolygon(0, 0, [[0, 0]])).toBe(false);
  });
  it('handles a concave (L-shaped) polygon', () => {
    const el: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    expect(pointInPolygon(2, 8, el)).toBe(true); // vertical branch of the L
    expect(pointInPolygon(8, 8, el)).toBe(false); // notch of the L
  });
});

describe('shapePredicate', () => {
  it('delegates to the right test depending on the shape', () => {
    const rect = shapePredicate({ kind: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } });
    expect(rect(5, 5)).toBe(true);
    expect(rect(15, 5)).toBe(false);
    const lasso = shapePredicate({
      kind: 'lasso',
      points: [
        [0, 0],
        [10, 0],
        [5, 10],
      ],
    });
    expect(lasso(5, 3)).toBe(true);
    expect(lasso(9, 9)).toBe(false);
  });
});

describe('combineSelection', () => {
  const prev = new Set([1, 2, 3]);
  it('replace: starts from scratch', () => {
    expect([...combineSelection(prev, [4, 5], 'replace')].sort()).toEqual([4, 5]);
  });
  it('add: union', () => {
    expect([...combineSelection(prev, [3, 4], 'add')].sort()).toEqual([1, 2, 3, 4]);
  });
  it('subtract: removes the touched ones', () => {
    expect([...combineSelection(prev, [2, 9], 'subtract')].sort()).toEqual([1, 3]);
  });
  it('does not mutate the previous selection', () => {
    combineSelection(prev, [9], 'add');
    expect([...prev].sort()).toEqual([1, 2, 3]);
  });
});
