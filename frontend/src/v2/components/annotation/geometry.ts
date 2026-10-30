// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure geometry of the annotation canvas (normalized coordinates 0..1, aspect corrections
 * in screen space). Extracted from AnnotationCanvas (10.F4 budget), tested.
 */

/**
 * Canvas tools. `ref` draws none: it makes the canvas transparent to the pointer so that
 * the layer of pasted references receives the gesture (placing and positioning a reference).
 */
export type Tool = 'draw' | 'rect' | 'ellipse' | 'arrow' | 'polygon' | 'text' | 'move' | 'erase' | 'ref';

export interface Shape {
  id: string;
  type: 'path' | 'rect' | 'ellipse' | 'arrow' | 'polygon' | 'text';
  color: string;
  width: number;
  alpha?: number; // opacité 0..1 (défaut 1)
  pts?: number[][]; // path
  x?: number;
  y?: number;
  w?: number;
  h?: number; // rect (x/y = ancre du texte)
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number; // ellipse
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number; // arrow
  text?: string; // texte (10.G backlog : annotations avancées)
}

/** Normalized font height (fraction of the media height) according to the chosen thickness. */
export const textFontSize = (width: number): number => 0.02 + width * 0.005;

export interface ArrowHead {
  /** Tip (= endpoint). */
  tip: [number, number];
  /** Left and right wings of the triangle. */
  left: [number, number];
  right: [number, number];
  /** End of the shaft: slightly INSIDE the head (no gap between line and triangle). */
  shaftEnd: [number, number];
}

/**
 * Arrow head computed in **screen space** (px), then returned in normalized coordinates:
 * the head is never distorted by the stretched viewBox (aspect ≠ 1),
 * and its size follows the stroke thickness. Crisp triangle (rendered fill+stroke with round joins
 * on the ShapeEl side, so softened corners). `size` = canvas px dimensions.
 */
export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: { w: number; h: number },
  strokeWidth: number,
): ArrowHead | null {
  if (size.w <= 0 || size.h <= 0) return null;
  const ax = x1 * size.w,
    ay = y1 * size.h,
    bx = x2 * size.w,
    by = y2 * size.h;
  const dx = bx - ax,
    dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len,
    uy = dy / len;
  // Perpendiculaire unitaire.
  const px = -uy,
    py = ux;
  // Head proportional to the thickness (angle ~40°), bounded by the length of the stroke.
  const headLen = Math.min(Math.max(10, strokeWidth * 3.5), len * 0.45);
  const headW = headLen * 0.75;
  const baseX = bx - ux * headLen,
    baseY = by - uy * headLen;
  const norm = (x: number, y: number): [number, number] => [x / size.w, y / size.h];
  return {
    tip: norm(bx, by),
    left: norm(baseX + (px * headW) / 2, baseY + (py * headW) / 2),
    right: norm(baseX - (px * headW) / 2, baseY - (py * headW) / 2),
    shaftEnd: norm(bx - ux * headLen * 0.85, by - uy * headLen * 0.85),
  };
}

/**
 * Shape under point `p` (normalized coordinates): simple proximity test,
 * the last drawn first. Used by the eraser, the move tool and
 * their hover preview.
 */
export function hitShape(shapes: Shape[], p: [number, number]): Shape | undefined {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.03;
  return [...shapes].reverse().find((s) => {
    if (s.type === 'path' || s.type === 'polygon')
      return s.pts?.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 0.03);
    if (s.type === 'rect')
      return (
        p[0] >= (s.x ?? 0) - 0.02 &&
        p[0] <= (s.x ?? 0) + (s.w ?? 0) + 0.02 &&
        p[1] >= (s.y ?? 0) - 0.02 &&
        p[1] <= (s.y ?? 0) + (s.h ?? 0) + 0.02
      );
    if (s.type === 'ellipse')
      return (
        Math.hypot(
          (p[0] - (s.cx ?? 0)) / ((s.rx ?? 0.01) + 0.02),
          (p[1] - (s.cy ?? 0)) / ((s.ry ?? 0.01) + 0.02),
        ) <= 1
      );
    if (s.type === 'arrow') {
      // Distance to the segment (and no longer to the tip alone): more natural erase and move.
      const x1 = s.x1 ?? 0,
        y1 = s.y1 ?? 0,
        x2 = s.x2 ?? 0,
        y2 = s.y2 ?? 0;
      const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
      if (l2 < 1e-12) return near(p[0], x2) && near(p[1], y2);
      const t = Math.max(0, Math.min(1, ((p[0] - x1) * (x2 - x1) + (p[1] - y1) * (y2 - y1)) / l2));
      return Math.hypot(p[0] - (x1 + t * (x2 - x1)), p[1] - (y1 + t * (y2 - y1))) < 0.03;
    }
    if (s.type === 'text')
      // Approximate zone: from the anchor to the right (the text extends from its point).
      return p[0] >= (s.x ?? 0) - 0.02 && p[0] <= (s.x ?? 0) + 0.25 && Math.abs(p[1] - (s.y ?? 0)) <= 0.04;
    return false;
  });
}

/** Translation of a shape (move tool). */
export function translateShape(s: Shape, dx: number, dy: number): Shape {
  if (s.type === 'path' || s.type === 'polygon')
    return { ...s, pts: s.pts?.map(([x, y]) => [x + dx, y + dy]) };
  if (s.type === 'rect' || s.type === 'text') return { ...s, x: (s.x ?? 0) + dx, y: (s.y ?? 0) + dy };
  if (s.type === 'ellipse') return { ...s, cx: (s.cx ?? 0) + dx, cy: (s.cy ?? 0) + dy };
  return { ...s, x1: (s.x1 ?? 0) + dx, y1: (s.y1 ?? 0) + dy, x2: (s.x2 ?? 0) + dx, y2: (s.y2 ?? 0) + dy };
}

/** Ellipse inscribed in the rectangle defined by two corners (drawn corner to corner, like the rect). */
export function ellipseFromCorners(
  start: [number, number],
  p: [number, number],
): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: (start[0] + p[0]) / 2,
    cy: (start[1] + p[1]) / 2,
    rx: Math.abs(p[0] - start[0]) / 2,
    ry: Math.abs(p[1] - start[1]) / 2,
  };
}

/** Normalizes a rect drawn in any direction (positive w and h). */
export function normalizeRect(s: Shape): Shape {
  if (s.type === 'rect') {
    const x = Math.min(s.x ?? 0, (s.x ?? 0) + (s.w ?? 0));
    const y = Math.min(s.y ?? 0, (s.y ?? 0) + (s.h ?? 0));
    return { ...s, x, y, w: Math.abs(s.w ?? 0), h: Math.abs(s.h ?? 0) };
  }
  return s;
}
