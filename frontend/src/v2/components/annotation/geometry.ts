/**
 * Géométrie pure du canvas d'annotation (coordonnées normalisées 0..1, corrections
 * d'aspect en espace écran). Extraite d'AnnotationCanvas (budget 10.F4) — testée.
 */

export type Tool = 'draw' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'move' | 'erase';

export interface Shape {
  id: string;
  type: 'path' | 'rect' | 'ellipse' | 'arrow' | 'text';
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

/** Hauteur de police normalisée (fraction de la hauteur du média) selon l'épaisseur choisie. */
export const textFontSize = (width: number): number => 0.02 + width * 0.005;

export interface ArrowHead {
  /** Pointe (= point d'arrivée). */
  tip: [number, number];
  /** Ailes gauche/droite du triangle. */
  left: [number, number];
  right: [number, number];
  /** Fin du fût : légèrement DANS la tête (aucun jour entre trait et triangle). */
  shaftEnd: [number, number];
}

/**
 * Tête de flèche calculée en **espace écran** (px) puis renvoyée en coordonnées
 * normalisées : la tête n'est jamais déformée par le viewBox étiré (aspect ≠ 1),
 * et sa taille suit l'épaisseur du trait. Triangle net (rendu fill+stroke à joints
 * ronds côté ShapeEl → coins adoucis). `size` = dimensions px du canvas.
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
  // Tête proportionnelle à l'épaisseur (angle ~40°), bornée par la longueur du trait.
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
 * Forme sous le point `p` (coordonnées normalisées) — test de proximité simple,
 * la dernière dessinée en premier. Utilisé par la gomme, l'outil déplacement et
 * leur prévisualisation au survol.
 */
export function hitShape(shapes: Shape[], p: [number, number]): Shape | undefined {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.03;
  return [...shapes].reverse().find((s) => {
    if (s.type === 'path') return s.pts?.some(([x, y]) => Math.hypot(x! - p[0], y! - p[1]) < 0.03);
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
      // Distance au segment (et non plus à la seule pointe) : gomme/déplacement plus naturels.
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
      // Zone approximative : de l'ancre vers la droite (le texte s'étend depuis son point).
      return p[0] >= (s.x ?? 0) - 0.02 && p[0] <= (s.x ?? 0) + 0.25 && Math.abs(p[1] - (s.y ?? 0)) <= 0.04;
    return false;
  });
}

/** Translation d'une forme (outil déplacement). */
export function translateShape(s: Shape, dx: number, dy: number): Shape {
  if (s.type === 'path') return { ...s, pts: s.pts?.map(([x, y]) => [x! + dx, y! + dy]) };
  if (s.type === 'rect' || s.type === 'text') return { ...s, x: (s.x ?? 0) + dx, y: (s.y ?? 0) + dy };
  if (s.type === 'ellipse') return { ...s, cx: (s.cx ?? 0) + dx, cy: (s.cy ?? 0) + dy };
  return { ...s, x1: (s.x1 ?? 0) + dx, y1: (s.y1 ?? 0) + dy, x2: (s.x2 ?? 0) + dx, y2: (s.y2 ?? 0) + dy };
}

/** Normalise un rect dessiné dans n'importe quel sens (w/h positifs). */
export function normalizeRect(s: Shape): Shape {
  if (s.type === 'rect') {
    const x = Math.min(s.x ?? 0, (s.x ?? 0) + (s.w ?? 0));
    const y = Math.min(s.y ?? 0, (s.y ?? 0) + (s.h ?? 0));
    return { ...s, x, y, w: Math.abs(s.w ?? 0), h: Math.abs(s.h ?? 0) };
  }
  return s;
}
