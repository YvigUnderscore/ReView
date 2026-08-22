// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Planche des notes annotées, en HTML imprimable.
 *
 * Le PDF a été écarté sciemment : le produire sans dépendance imposerait d'écrire un
 * encodeur d'images dans le fichier PDF (DCTDecode pour le JPEG, Flate + prédicteurs pour
 * le PNG), soit la partie du format la plus facile à écrire faux — et une planche de notes
 * sans les frames ne vaut rien. Le document produit ici est autonome (images en data URI,
 * styles inclus, aucune ressource externe) : ouvert dans un navigateur, `Ctrl+P` →
 * « Enregistrer au format PDF » donne le PDF attendu, mise en page comprise.
 *
 * Le module est PUR : le service lui donne des libellés déjà traduits et des images déjà
 * encodées. Les couleurs sont écrites en dur — c'est un document autonome, pas une surface
 * de l'application, et il doit s'imprimer correctement sur du papier blanc.
 */

import { escapeHtml } from './html';

/**
 * Image d'illustration d'une note. Deux cas : une image entière (miniature du média) ou
 * une tuile de la sprite de timeline — la vignette la plus proche de l'instant commenté,
 * que le worker a déjà calculée pour le survol de la timeline. Découper la sprite en CSS
 * évite d'extraire une frame par note avec ffmpeg, ce qu'une requête HTTP ne peut pas
 * attendre pour trois cents notes.
 */
export interface SheetImage {
  /** Data URI complet (`data:image/jpeg;base64,…`). */
  src: string;
  /** Dimensions affichées de la vignette, en pixels. */
  width: number;
  height: number;
  /** Tuile dans une sprite : décalage et taille de la planche entière, en pixels. */
  tile?: { offsetX: number; offsetY: number; sheetWidth: number; sheetHeight: number };
}

export interface SheetNote {
  location: string;
  /** Frame affichée, telle que la review la montre. */
  frame: string | null;
  timecode: string | null;
  author: string;
  createdAt: string;
  state: string;
  decision: string | null;
  /** Texte de la note, déjà mis à plat. */
  text: string;
  image: SheetImage | null;
  /** SVG de l'annotation, aux dimensions de la vignette (null = rien de dessiné). */
  annotationSvg: string | null;
  /** Note qui répond à une autre : affichée en retrait. */
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
  /** Avertissement de troncature, déjà traduit (null = planche complète). */
  truncated: string | null;
}

/**
 * Filet de sécurité avant d'incruster un SVG dans le document.
 *
 * `annotationToSvg` compose ses attributs à partir de la couleur enregistrée avec la
 * forme, qui vient du client. Dans un fichier lu par ffmpeg, un guillemet mal placé ne
 * produisait qu'un rendu raté ; dans un document HTML ouvert par un navigateur, il
 * ouvrirait la porte à du balisage arbitraire. On rejette donc en bloc tout SVG qui porte
 * un gestionnaire d'événement, un script ou une URL exécutable, plutôt que de recoudre le
 * balisage — une planche sans le dessin reste lisible, une planche piégée non.
 */
export function sanitizeInlineSvg(svg: string | null): string | null {
  if (!svg) return null;
  if (/<\s*(script|foreignObject|iframe|use|image)\b/i.test(svg)) return null;
  if (/\son[a-z]+\s*=/i.test(svg)) return null;
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

function imageBlock(note: SheetNote, labels: SheetLabels): string {
  const svg = sanitizeInlineSvg(note.annotationSvg) ?? '';
  const image = note.image;
  if (!image) {
    return `<div class="shot" style="width:160px;height:90px"><div class="none">${escapeHtml(
      labels.noFrame,
    )}</div>${svg}</div>`;
  }
  const box = `width:${image.width}px;height:${image.height}px`;
  if (image.tile) {
    const pos = `background-position:-${image.tile.offsetX}px -${image.tile.offsetY}px`;
    const size = `background-size:${image.tile.sheetWidth}px ${image.tile.sheetHeight}px`;
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

/** Compose la planche complète (document HTML autonome). */
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
