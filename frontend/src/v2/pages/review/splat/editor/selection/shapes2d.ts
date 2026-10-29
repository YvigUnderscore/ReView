// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 2D geometry of the splat selection (10.G): pure functions (testable without WebGL).
 * Shapes are expressed in screen pixels; the 3D→2D projection lives in `screenSelect.ts`.
 */

export interface Rect2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Selection shape drawn on screen: rectangle (marquee) or free polygon (lasso). */
export type SelectionShape = { kind: 'rect'; rect: Rect2D } | { kind: 'lasso'; points: [number, number][] };

/** Combination with the existing selection (modifiers: Shift = add, Alt = remove). */
export type SelectCombine = 'replace' | 'add' | 'subtract';

/** Normalized rectangle (w/h ≥ 0) from any two drag corners. */
export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect2D {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

export function pointInRect(x: number, y: number, r: Rect2D): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Point in polygon (even-odd ray casting); the polygon is implicitly closed. */
export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Screen predicate (px) matching a selection shape. */
export function shapePredicate(shape: SelectionShape): (x: number, y: number) => boolean {
  if (shape.kind === 'rect') return (x, y) => pointInRect(x, y, shape.rect);
  return (x, y) => pointInPolygon(x, y, shape.points);
}

/** Merges the touched indices with the previous selection according to the mode. */
export function combineSelection(
  prev: ReadonlySet<number>,
  hits: Iterable<number>,
  combine: SelectCombine,
): Set<number> {
  const next = combine === 'replace' ? new Set<number>() : new Set(prev);
  if (combine === 'subtract') for (const i of hits) next.delete(i);
  else for (const i of hits) next.add(i);
  return next;
}
