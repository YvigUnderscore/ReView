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
 * Balises que `annotationToSvg` émet réellement — et donc les seules admises ici.
 *
 * Une liste d'éléments interdits se contourne : il suffit d'en citer un qu'elle ignore
 * (`<animate>`, `<set>`, `<a>`, `<style>`…). La liste des éléments ATTENDUS, elle, ne se
 * contourne pas. Elle doit s'élargir en même temps que le rendu : une forme nouvelle dont
 * la balise manque ici disparaît de la planche, ce qui se voit, plutôt que de passer.
 */
const ALLOWED_SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'ellipse', 'line', 'polygon', 'text']);

/** Toute ouverture de balise, y compris `<!…`, `<?…` et un `<` esseulé (nom vide). */
const TAG_OPEN = /<\s*\/?\s*([^\s/>]*)/g;

/**
 * Filet de sécurité avant d'incruster un SVG dans le document.
 *
 * Ce n'est qu'un filet : la vraie défense est dans `annotationSvg.ts`, qui ne compose plus
 * ses attributs qu'à partir de valeurs contraintes (couleur hexadécimale, nombres finis).
 * Le filtre reste parce que le SVG, lui, traverse ensuite un document HTML ouvert dans un
 * navigateur — et parce que la version précédente de ce filtre a été prise en défaut : sa
 * règle des gestionnaires exigeait un BLANC devant (`\son…=`), si bien qu'un `/onbegin=`
 * — forme que l'analyseur HTML accepte pour séparer deux attributs — passait intact.
 *
 * On rejette donc en bloc plutôt que de recoudre le balisage : une planche sans le dessin
 * reste lisible, une planche piégée non.
 */
export function sanitizeInlineSvg(svg: string | null): string | null {
  if (!svg) return null;
  for (const match of svg.matchAll(TAG_OPEN)) {
    if (!ALLOWED_SVG_TAGS.has((match[1] ?? '').toLowerCase())) return null;
  }
  // Un gestionnaire peut être séparé de l'attribut précédent par un blanc, un solidus, ou
  // le guillemet fermant lui-même : `stroke="x"onload=` est recollé par les navigateurs.
  if (/["'\s/]on[a-z]+\s*=/i.test(svg)) return null;
  // Aucune forme rendue ne porte de lien : un `href` ici ne peut être qu'ajouté.
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
 * Data URI d'image, seule forme de source admise dans la planche.
 *
 * Le document se veut autonome : il n'a aucune raison d'aller chercher une ressource
 * ailleurs. Contraindre la source ici évite qu'une URL quelconque — `javascript:`, ou
 * simplement un pixel traçant chez un tiers — n'entre dans un `src` ou dans un `url()`
 * CSS, où l'échappement HTML ne protégerait de rien.
 */
const DATA_IMAGE = /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/;

/** Le seul type d'image qui embarque du balisage exécutable. */
const DATA_SVG = /^data:image\/svg/i;

/** Longueur en pixels : un entier positif, jamais une chaîne recopiée dans un style. */
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
