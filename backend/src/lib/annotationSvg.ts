// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Renders a review annotation as SVG.
 *
 * Annotations are stored in normalised coordinates (0..1) so they follow the display size of the
 * media. Sending them as-is outside ReView would serve nobody: this module renders them at a given
 * size so that a third-party tool (or ffmpeg, which reads SVG) can burn them onto the image.
 *
 * The rendering deliberately reuses the browser overlay's geometry: a note must point at exactly
 * the same place on both sides.
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

/** Usable shapes of a value coming from the database (untyped JSON). */
export function parseShapes(annotation: unknown): AnnotationShape[] {
  const raw = Array.isArray(annotation) ? annotation : ((annotation as { shapes?: unknown })?.shapes ?? null);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is AnnotationShape =>
      Boolean(s) && typeof s === 'object' && typeof (s as AnnotationShape).type === 'string',
  );
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Fallback colour: the one the viewer gives a stroke with no colour of its own. */
const DEFAULT_COLOR = '#FF3B30';

/**
 * A colour is not free text: it is a closed-set value.
 *
 * Escaping would not be enough here. `stroke=""` accepts CSS functions, and the value comes from a
 * comment JSON any project member can write: a colour closing its attribute to inject an
 * `<animate onbegin>` got through the notes-sheet filter. So ONLY the hexadecimal notation the
 * viewer produces is accepted; anything else falls back to the default colour. A badly coloured
 * marker is still a marker; a closed attribute is an injection into a document production opens
 * in its browser.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const safeColor = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  return HEX_COLOR.test(raw) ? raw : DEFAULT_COLOR;
};

/**
 * Finite number, or fallback.
 *
 * Coordinates went through a multiplication, which constrains the result to a number or `NaN`;
 * `opacity` was written as-is, a second injection point just like the colour. A numeric value is
 * therefore validated as a number before reaching an attribute, never as an escaped string.
 */
const num = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Default brush width, in pixels, as in the viewer
 * (`frontend/src/v2/pages/review/useAnnotations.ts`).
 */
const DEFAULT_STROKE_PX = 3;

/**
 * Reference display width, in pixels.
 *
 * A stroke width is stored in SCREEN pixels: the viewer draws in a normalised viewBox with
 * `vector-effect: non-scaling-stroke`, so a 3 px stroke stays 3 px thick whatever size the media is
 * displayed at. Rendering at the real media size therefore requires relating that width to the
 * width at which it was annotated, which is no longer known afterwards. We keep a typical display
 * width so the stroke keeps the relative fineness it had on screen.
 *
 * Treating this value as a fraction of the width, which this module used to do, read "3" as "three
 * times the media width": a 2217 px stroke on a 739 px image, i.e. a flat colour covering the frame.
 */
const REFERENCE_WIDTH = 1280;

/** Stroke width at the scale of the rendered image. */
const strokeWidth = (shape: AnnotationShape, width: number): number =>
  Math.max(1, num(shape.width, DEFAULT_STROKE_PX) * (width / REFERENCE_WIDTH));

/**
 * Font size, as a fraction of the media height and then in pixels: same formula as `textFontSize`
 * on the viewer side, so the text has the size it was given.
 */
const fontSize = (shape: AnnotationShape, height: number): number =>
  Math.max(8, (0.02 + num(shape.width, DEFAULT_STROKE_PX) * 0.005) * height);

function shapeToSvg(shape: AnnotationShape, w: number, h: number): string {
  // The three values below are the only ones in the rendering not born from a computation:
  // they are therefore constrained here, at the source, not escaped further on.
  const color = safeColor(shape.color);
  const sw = strokeWidth(shape, w);
  const opacity = clamp(num(shape.alpha, 1), 0, 1);
  const common = `stroke="${color}" stroke-width="${sw}" fill="none" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"`;

  switch (shape.type) {
    case 'path':
    case 'polygon': {
      // A point is not necessarily a pair: destructuring a non-iterable value (a number, an object)
      // would throw in the middle of the export.
      const raw: unknown[] = Array.isArray(shape.pts) ? shape.pts : [];
      const pts = raw
        .filter((p): p is unknown[] => Array.isArray(p))
        .map((p) => `${num(p[0], 0) * w},${num(p[1], 0) * h}`);
      if (pts.length < 2) return '';
      const d = `M ${pts.join(' L ')}`;
      return `<path d="${d}${shape.type === 'polygon' ? ' Z' : ''}" ${common} />`;
    }
    case 'rect': {
      const x = num(shape.x, 0) * w;
      const y = num(shape.y, 0) * h;
      return `<rect x="${x}" y="${y}" width="${num(shape.w, 0) * w}" height="${num(shape.h, 0) * h}" ${common} />`;
    }
    case 'ellipse':
      return `<ellipse cx="${num(shape.cx, 0) * w}" cy="${num(shape.cy, 0) * h}" rx="${num(shape.rx, 0) * w}" ry="${num(shape.ry, 0) * h}" ${common} />`;
    case 'arrow': {
      const x1 = num(shape.x1, 0) * w;
      const y1 = num(shape.y1, 0) * h;
      const x2 = num(shape.x2, 0) * w;
      const y2 = num(shape.y2, 0) * h;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return '';
      // Hand-drawn head: an SVG marker inherits the colour of a stroke badly through converters, and
      // the arrow would lose its head in conversion. Same proportions as the viewer (`arrowHead`),
      // capped by the stroke length: without this cap a short arrow is swallowed by its own head.
      const head = Math.min(Math.max(10, sw * 3.5), len * 0.45);
      const headW = head * 0.75;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const baseX = x2 - ux * head;
      const baseY = y2 - uy * head;
      return (
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${common} />` +
        `<polygon points="${x2},${y2} ${baseX + (px * headW) / 2},${baseY + (py * headW) / 2} ${baseX - (px * headW) / 2},${baseY - (py * headW) / 2}" fill="${color}" opacity="${opacity}" />`
      );
    }
    case 'text': {
      const size = fontSize(shape, h);
      // `text` may not be a string: calling `replace` on it would bring the whole export down with a
      // 500 instead of ignoring a malformed shape.
      const label = typeof shape.text === 'string' ? shape.text : '';
      return `<text x="${num(shape.x, 0) * w}" y="${num(shape.y, 0) * h}" fill="${color}" opacity="${opacity}" font-size="${size}" font-family="sans-serif">${escapeXml(label)}</text>`;
    }
    default:
      return '';
  }
}

/**
 * Transparent SVG document at the media dimensions, ready to be embedded.
 * Returns `null` when there is nothing to draw: no point composing an empty image.
 */
export function annotationToSvg(annotation: unknown, width: number, height: number): string | null {
  const shapes = parseShapes(annotation);
  if (shapes.length === 0) return null;
  // Dimensions come from the caller, not from the client, but are still bounded: a `NaN` in the
  // viewBox produces a document that neither ffmpeg nor the browser can read.
  const w = Math.max(1, Math.round(num(width, 0)));
  const h = Math.max(1, Math.round(num(height, 0)));
  const body = shapes.map((s) => shapeToSvg(s, w, h)).join('');
  if (!body) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
