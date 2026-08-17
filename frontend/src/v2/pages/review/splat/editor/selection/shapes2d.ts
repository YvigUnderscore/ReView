// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Géométrie 2D de la sélection de splats (10.G) — fonctions pures (testables sans WebGL).
 * Les formes sont exprimées en pixels écran ; la projection 3D→2D vit dans `screenSelect.ts`.
 */

export interface Rect2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Forme de sélection tracée à l'écran : rectangle (marquee) ou polygone libre (lasso). */
export type SelectionShape = { kind: 'rect'; rect: Rect2D } | { kind: 'lasso'; points: [number, number][] };

/** Combinaison avec la sélection existante (modificateurs Maj = ajouter, Alt = retirer). */
export type SelectCombine = 'replace' | 'add' | 'subtract';

/** Rectangle normalisé (w/h ≥ 0) à partir de deux coins de drag quelconques. */
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

/** Point dans polygone (ray casting pair/impair) — polygone implicitement fermé. */
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

/** Prédicat écran (px) correspondant à une forme de sélection. */
export function shapePredicate(shape: SelectionShape): (x: number, y: number) => boolean {
  if (shape.kind === 'rect') return (x, y) => pointInRect(x, y, shape.rect);
  return (x, y) => pointInPolygon(x, y, shape.points);
}

/** Fusionne les indices touchés avec la sélection précédente selon le mode. */
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
