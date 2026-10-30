// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sheet of annotated notes, in printable HTML.
 *
 * PDF was deliberately set aside: producing it without a dependency would mean writing an image encoder into the PDF
 * file (DCTDecode for the JPEG, Flate + predictors for the PNG), the part of the format easiest to get wrong — and a
 * notes sheet without the frames is worthless. The document produced here is standalone (images as data URIs, styles
 * included, no external resource): opened in a browser, `Ctrl+P` → "Save as PDF" gives the expected PDF, layout included.
 *
 * The module is PURE: the service gives it already translated labels and already encoded images. Colours are hard-coded:
 * it is a standalone document, not a surface of the application, and it must print properly on white paper.
 */

import { escapeHtml } from './html';

/**
 * Illustration image of a note. Two cases: a whole image (media thumbnail) or a tile of the timeline sprite — the
 * thumbnail closest to the commented instant, which the worker has already computed for the timeline hover. Cutting
 * the sprite in CSS avoids extracting one frame per note with ffmpeg, which an HTTP request cannot wait for across
 * three hundred notes.
 */
export interface SheetImage {
  /** Full data URI (`data:image/jpeg;base64,…`). */
  src: string;
  /** Displayed dimensions of the thumbnail, in pixels. */
  width: number;
  height: number;
  /** Tile within a sprite: offset and size of the whole sheet, in pixels. */
  tile?: { offsetX: number; offsetY: number; sheetWidth: number; sheetHeight: number };
}

export interface SheetNote {
  location: string;
  /** Displayed frame, as the review shows it. */
  frame: string | null;
  timecode: string | null;
  author: string;
  createdAt: string;
  state: string;
  decision: string | null;
  /** Note text, already flattened. */
  text: string;
  image: SheetImage | null;
  /** SVG of the annotation, at the thumbnail's dimensions (null = nothing drawn). */
  annotationSvg: string | null;
  /** Note replying to another: displayed indented. */
  reply: boolean;
}

export interface SheetLabels {
  frame: string;
  timecode: string;
  state: string;
  decision: string;
  noFrame: string;
  printHint: string;
  empty: string;
  reply: string;
}

export interface SheetInput {
  title: string;
  subtitle: string;
  labels: SheetLabels;
  notes: SheetNote[];
  /** Truncation warning, already translated (null = complete sheet). */
  truncated: string | null;
}

/**
 * Tags that `annotationToSvg` actually emits — and therefore the only ones admitted here.
 *
 * A list of forbidden elements can be bypassed: it is enough to cite one it ignores (`<animate>`, `<set>`, `<a>`,
 * `<style>`...). The list of EXPECTED elements cannot be bypassed. It must grow together with the renderer: a new shape
 * whose tag is missing here disappears from the sheet, which is visible, rather than slipping through.
 */
const ALLOWED_SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'ellipse', 'line', 'polygon', 'text']);

/** Any tag opening, including `<!…`, `<?…` and a lone `<` (empty name). */
const TAG_OPEN = /<\s*\/?\s*([^\s/>]*)/g;

/**
 * Safety net before embedding an SVG in the document.
 *
 * It is only a net: the real defence is in `annotationSvg.ts`, which only composes its attributes from constrained values
 * (hexadecimal colour, finite numbers). The filter stays because the SVG then goes through an HTML document opened in a
 * browser — and because the previous version of this filter was caught out: its handler rule required a WHITESPACE
 * before (`\son…=`), so an `/onbegin=` — a form the HTML parser accepts to separate two attributes — passed intact.
 *
 * We therefore reject in one piece rather than stitching the markup back together: a sheet without the drawing stays
 * readable, a trapped sheet does not.
 */
export function sanitizeInlineSvg(svg: string | null): string | null {
  if (!svg) return null;
  for (const match of svg.matchAll(TAG_OPEN)) {
    if (!ALLOWED_SVG_TAGS.has((match[1] ?? '').toLowerCase())) return null;
  }
  // A handler may be separated from the previous attribute by a whitespace, a solidus, or the closing quote itself:
  // `stroke="x"onload=` is glued together by browsers.
  if (/["'\s/]on[a-z]+\s*=/i.test(svg)) return null;
  // No rendered shape carries a link: an `href` here can only have been added.
  if (/["'\s/](?:xlink:)?href\s*=/i.test(svg)) return null;
  if (/(javascript|vbscript)\s*:/i.test(svg)) return null;
  return svg;
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: #f4f5f7; color: #14161a;
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { margin: 0 0 4px; font-size: 20px; }
.sub { margin: 0; color: #5b6472; font-size: 12px; }
.hint { margin: 12px 0 20px; padding: 8px 10px; border-radius: 6px;
  background: #e7eefb; color: #22406e; font-size: 12px; }
.warn { margin: 0 0 16px; padding: 8px 10px; border-radius: 6px;
  background: #fdf0e2; color: #7a4a12; font-size: 12px; }
.note { display: flex; gap: 16px; margin-bottom: 14px; padding: 12px; border-radius: 8px;
  background: #ffffff; border: 1px solid #dfe3e9; page-break-inside: avoid; break-inside: avoid; }
.note--reply { margin-left: 32px; border-left: 3px solid #c8cfda; }
.shot { position: relative; flex: 0 0 auto; overflow: hidden; border-radius: 4px;
  background: #101216; }
.shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
.shot .tile { background-repeat: no-repeat; }
.shot svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.shot .none { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center;
  color: #8b93a1; font-size: 11px; text-align: center; padding: 4px; }
.body { min-width: 0; flex: 1; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 6px;
  color: #5b6472; font-size: 11px; }
.meta b { color: #14161a; font-weight: 600; }
.loc { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #3b4453; }
.text { white-space: pre-wrap; overflow-wrap: anywhere; }
.empty { padding: 40px; text-align: center; color: #5b6472; }
@media print {
  body { padding: 0; background: #ffffff; }
  .hint { display: none; }
  .note { border-color: #c8cfda; }
}
`;

/**
 * Image data URI, the only form of source admitted in the sheet.
 *
 * The document is meant to be standalone: it has no reason to fetch a resource elsewhere. Constraining the source here
 * prevents any arbitrary URL — `javascript:`, or simply a tracking pixel on a third party — from entering a `src` or a
 * CSS `url()`, where HTML escaping would protect nothing.
 */
const DATA_IMAGE = /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/;

/** The only image type that embeds executable markup. */
const DATA_SVG = /^data:image\/svg/i;

/** Length in pixels: a positive integer, never a string copied into a style. */
const px = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;

function imageBlock(note: SheetNote, labels: SheetLabels): string {
  const svg = sanitizeInlineSvg(note.annotationSvg) ?? '';
  const usable = (src: string): boolean => DATA_IMAGE.test(src) && !DATA_SVG.test(src);
  const image = note.image && usable(note.image.src) ? note.image : null;
  if (!image) {
    return `<div class="shot" style="width:160px;height:90px"><div class="none">${escapeHtml(
      labels.noFrame,
    )}</div>${svg}</div>`;
  }
  const box = `width:${px(image.width, 160)}px;height:${px(image.height, 90)}px`;
  if (image.tile) {
    const pos = `background-position:-${px(image.tile.offsetX, 0)}px -${px(image.tile.offsetY, 0)}px`;
    const size = `background-size:${px(image.tile.sheetWidth, 0)}px ${px(image.tile.sheetHeight, 0)}px`;
    const bg = `background-image:url('${image.src}')`;
    return `<div class="shot" style="${box}"><div class="tile" style="${box};${bg};${pos};${size}"></div>${svg}</div>`;
  }
  return `<div class="shot" style="${box}"><img src="${image.src}" alt="" />${svg}</div>`;
}

function metaBlock(note: SheetNote, labels: SheetLabels): string {
  const parts = [`<span><b>${escapeHtml(note.author)}</b> · ${escapeHtml(note.createdAt)}</span>`];
  if (note.frame) parts.push(`<span>${escapeHtml(labels.frame)} <b>${escapeHtml(note.frame)}</b></span>`);
  if (note.timecode)
    parts.push(`<span>${escapeHtml(labels.timecode)} <b>${escapeHtml(note.timecode)}</b></span>`);
  parts.push(`<span>${escapeHtml(labels.state)} <b>${escapeHtml(note.state)}</b></span>`);
  if (note.decision)
    parts.push(`<span>${escapeHtml(labels.decision)} <b>${escapeHtml(note.decision)}</b></span>`);
  if (note.reply) parts.push(`<span>${escapeHtml(labels.reply)}</span>`);
  return `<div class="meta">${parts.join('')}</div>`;
}

function noteBlock(note: SheetNote, labels: SheetLabels): string {
  return (
    `<article class="note${note.reply ? ' note--reply' : ''}">` +
    imageBlock(note, labels) +
    `<div class="body">${metaBlock(note, labels)}` +
    `<div class="loc">${escapeHtml(note.location)}</div>` +
    `<div class="text">${escapeHtml(note.text)}</div></div></article>`
  );
}

/** Composes the complete sheet (standalone HTML document). */
export function renderNotesSheet(input: SheetInput): string {
  const { labels } = input;
  const body = input.notes.length
    ? input.notes.map((n) => noteBlock(n, labels)).join('')
    : `<p class="empty">${escapeHtml(labels.empty)}</p>`;
  const warn = input.truncated ? `<p class="warn">${escapeHtml(input.truncated)}</p>` : '';
  return (
    '<!doctype html><html><head><meta charset="utf-8" />' +
    `<title>${escapeHtml(input.title)}</title><style>${STYLE}</style></head><body>` +
    `<h1>${escapeHtml(input.title)}</h1><p class="sub">${escapeHtml(input.subtitle)}</p>` +
    `<p class="hint">${escapeHtml(labels.printHint)}</p>${warn}${body}</body></html>`
  );
}
