// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transformation de vue de l'éditeur de courbes (Phase 17) : mapping pur temps↔pixel (axe X,
 * commun dopesheet + graph) et valeur↔pixel (axe Y, graph editor), avec zoom/pan. Testable sans DOM.
 */

/** Vue horizontale (temps) : `t0`/`t1` = bornes visibles en ms, `width` = largeur px du tracé. */
export interface TimeView {
  t0: number;
  t1: number;
  width: number;
}

/** Vue verticale (valeur) du graph editor : `v0`/`v1` bornes visibles, `height` = hauteur px. */
export interface ValueView {
  v0: number;
  v1: number;
  height: number;
}

export const timeToX = (t: number, view: TimeView): number =>
  view.t1 === view.t0 ? 0 : ((t - view.t0) / (view.t1 - view.t0)) * view.width;

export const xToTime = (x: number, view: TimeView): number =>
  view.t0 + (x / (view.width || 1)) * (view.t1 - view.t0);

// Y est inversé (valeur haute = pixel haut).
export const valueToY = (v: number, view: ValueView): number =>
  view.v1 === view.v0 ? view.height / 2 : ((view.v1 - v) / (view.v1 - view.v0)) * view.height;

export const yToValue = (y: number, view: ValueView): number =>
  view.v1 - (y / (view.height || 1)) * (view.v1 - view.v0);

/** Zoom horizontal centré sur le temps `pivotT` (molette) — `factor` < 1 = zoom avant. */
export function zoomTime(view: TimeView, pivotT: number, factor: number): TimeView {
  const t0 = pivotT - (pivotT - view.t0) * factor;
  const t1 = pivotT + (view.t1 - pivotT) * factor;
  return { ...view, t0, t1: Math.max(t1, t0 + 1) };
}

/** Décale la fenêtre temporelle de `deltaMs` (pan). */
export const panTime = (view: TimeView, deltaMs: number): TimeView => ({
  ...view,
  t0: view.t0 + deltaMs,
  t1: view.t1 + deltaMs,
});

/** Bornes valeur englobant une série (avec marge de 10 %), repli symétrique si constante. */
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
