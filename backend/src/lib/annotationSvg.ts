// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Rendu d'une annotation de review en SVG.
 *
 * Les annotations sont stockées en coordonnées normalisées (0..1) pour suivre la taille
 * d'affichage du média. Les envoyer telles quelles hors de ReView ne servirait à
 * personne : ce module les rend à une taille donnée, de façon qu'un outil tiers — ou
 * ffmpeg, qui sait lire le SVG — puisse les incruster sur l'image.
 *
 * Le rendu reprend volontairement la même géométrie que l'overlay du navigateur : une
 * remarque doit désigner exactement le même endroit des deux côtés.
 */

export interface AnnotationShape {
  id?: string;
  type: 'path' | 'rect' | 'ellipse' | 'arrow' | 'polygon' | 'text';
  color?: string;
  width?: number;
  alpha?: number;
  pts?: number[][];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  text?: string;
}

/** Formes exploitables d'une valeur venue de la base (JSON non typé). */
export function parseShapes(annotation: unknown): AnnotationShape[] {
  const raw = Array.isArray(annotation) ? annotation : ((annotation as { shapes?: unknown })?.shapes ?? null);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is AnnotationShape =>
      Boolean(s) && typeof s === 'object' && typeof (s as AnnotationShape).type === 'string',
  );
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Épaisseur en pixels : la valeur stockée est relative à la largeur du média. */
const strokeWidth = (shape: AnnotationShape, width: number): number =>
  Math.max(1, (shape.width ?? 0.004) * width);

function shapeToSvg(shape: AnnotationShape, w: number, h: number): string {
  const color = shape.color ?? '#FF3B30';
  const sw = strokeWidth(shape, w);
  const opacity = shape.alpha ?? 1;
  const common = `stroke="${color}" stroke-width="${sw}" fill="none" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"`;

  switch (shape.type) {
    case 'path':
    case 'polygon': {
      const pts = (shape.pts ?? []).map(([px, py]) => `${(px ?? 0) * w},${(py ?? 0) * h}`);
      if (pts.length < 2) return '';
      const d = `M ${pts.join(' L ')}`;
      return `<path d="${d}${shape.type === 'polygon' ? ' Z' : ''}" ${common} />`;
    }
    case 'rect': {
      const x = (shape.x ?? 0) * w;
      const y = (shape.y ?? 0) * h;
      return `<rect x="${x}" y="${y}" width="${(shape.w ?? 0) * w}" height="${(shape.h ?? 0) * h}" ${common} />`;
    }
    case 'ellipse':
      return `<ellipse cx="${(shape.cx ?? 0) * w}" cy="${(shape.cy ?? 0) * h}" rx="${(shape.rx ?? 0) * w}" ry="${(shape.ry ?? 0) * h}" ${common} />`;
    case 'arrow': {
      const x1 = (shape.x1 ?? 0) * w;
      const y1 = (shape.y1 ?? 0) * h;
      const x2 = (shape.x2 ?? 0) * w;
      const y2 = (shape.y2 ?? 0) * h;
      // Pointe dessinée à la main : un marqueur SVG hérite mal de la couleur d'un trait
      // à travers les convertisseurs, et la flèche perdrait sa tête à la conversion.
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(sw * 3, 8);
      const p1x = x2 - head * Math.cos(angle - Math.PI / 7);
      const p1y = y2 - head * Math.sin(angle - Math.PI / 7);
      const p2x = x2 - head * Math.cos(angle + Math.PI / 7);
      const p2y = y2 - head * Math.sin(angle + Math.PI / 7);
      return (
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${common} />` +
        `<polygon points="${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}" fill="${color}" opacity="${opacity}" />`
      );
    }
    case 'text': {
      const size = Math.max(10, (shape.width ?? 0.02) * h * 2);
      return `<text x="${(shape.x ?? 0) * w}" y="${(shape.y ?? 0) * h}" fill="${color}" opacity="${opacity}" font-size="${size}" font-family="sans-serif">${escapeXml(shape.text ?? '')}</text>`;
    }
    default:
      return '';
  }
}

/**
 * Document SVG transparent aux dimensions du média, prêt à être incrusté.
 * Renvoie `null` quand il n'y a rien à dessiner — inutile de composer une image vide.
 */
export function annotationToSvg(annotation: unknown, width: number, height: number): string | null {
  const shapes = parseShapes(annotation);
  if (shapes.length === 0) return null;
  const body = shapes.map((s) => shapeToSvg(s, width, height)).join('');
  if (!body) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}
