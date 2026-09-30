// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ACTION_SAFE_RATIO, CENTER_CROSS_RATIO, TITLE_SAFE_RATIO } from './guideStyle';

/**
 * Géométrie **pure** des repères de composition, en pixels de la boîte du média (le SVG qui
 * les porte a un `viewBox` en pixels CSS de sa propre boîte : une unité = un pixel, dans les
 * deux axes). C'est ce qui rend la croix centrale carrée — l'ancien overlay raisonnait en
 * pourcentages avec `preserveAspectRatio="none"`, donc en unités différentes en X et en Y :
 * ses deux branches n'avaient la même longueur qu'en 1:1.
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

/** Dimension exploitable (garde-fou : une boîte non mesurée vaut zéro). */
const side = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/** Règle des tiers : deux verticales, deux horizontales. */
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
 * Croix centrale **carrée** : les deux branches ont la même longueur, calée sur le plus petit
 * côté du cadre — elle reste donc carrée en 1:1, en 16:9 comme en 2.39:1, et ne déborde jamais.
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

/** Rectangle d'une safe area (fraction du cadre), centré. */
export function safeAreaRect(w: number, h: number, ratio: number): GuideRect {
  const bw = side(w);
  const bh = side(h);
  const r = Number.isFinite(ratio) && ratio > 0 ? Math.min(ratio, 1) : 1;
  // Marge déduite de la largeur retenue (et non `bw * (1 - r)`) : `1000 × 0,1` vaut
  // 99,999999… en flottant, et l'attribut SVG en portait toute la queue.
  const width = bw * r;
  const height = bh * r;
  return { x: (bw - width) / 2, y: (bh - height) / 2, width, height };
}

/** Safe area « action » (90 %). */
export const actionSafeRect = (w: number, h: number): GuideRect => safeAreaRect(w, h, ACTION_SAFE_RATIO);

/** Safe area « titre » (80 %). */
export const titleSafeRect = (w: number, h: number): GuideRect => safeAreaRect(w, h, TITLE_SAFE_RATIO);

/**
 * Liseré du cadre de livraison : rentré d'un demi-trait, sinon la moitié extérieure du trait
 * tombe hors du viewport SVG (qui rogne) et le liseré paraît deux fois plus fin que les
 * autres repères.
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
