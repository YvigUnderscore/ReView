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
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Couleur de repli — celle que le viewer donne à un trait sans couleur propre. */
const DEFAULT_COLOR = '#FF3B30';

/**
 * Une couleur n'est pas du texte libre : c'est une valeur de forme close.
 *
 * L'échappement ne suffirait pas ici. `stroke=""` accepte des fonctions CSS, et la valeur
 * vient d'un JSON de commentaire que n'importe quel membre du projet peut écrire : une
 * couleur qui refermait son attribut pour poser un `<animate onbegin>` a traversé le
 * filtre de la planche de notes. On n'accepte donc QUE la notation hexadécimale que le
 * viewer produit ; tout le reste retombe sur la couleur par défaut. Quitte à changer la
 * teinte d'un repère : un repère mal coloré reste un repère, un attribut refermé est une
 * injection dans un document que la production ouvre dans son navigateur.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const safeColor = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  return HEX_COLOR.test(raw) ? raw : DEFAULT_COLOR;
};

/**
 * Nombre fini, ou repli.
 *
 * Les coordonnées passaient par une multiplication, qui contraint le résultat à un nombre
 * ou à `NaN` ; `opacity`, elle, était écrite telle quelle — un second point d'injection,
 * au même titre que la couleur. Une valeur attendue numérique se valide donc comme un
 * nombre avant d'atteindre un attribut, jamais comme une chaîne échappée.
 */
const num = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Épaisseur par défaut du pinceau, en pixels — celle du viewer
 * (`frontend/src/v2/pages/review/useAnnotations.ts`).
 */
const DEFAULT_STROKE_PX = 3;

/**
 * Largeur d'affichage de référence, en pixels.
 *
 * L'épaisseur d'un trait est stockée en pixels ÉCRAN : le viewer dessine dans un viewBox
 * normalisé avec `vector-effect: non-scaling-stroke`, si bien qu'un trait de 3 px reste
 * épais de 3 px quelle que soit la taille à laquelle le média est affiché. Rendre à la
 * taille réelle du média demande donc de rapporter cette épaisseur à la largeur à
 * laquelle on annotait — qu'on ne connaît plus après coup. On retient une largeur
 * d'affichage courante : le trait garde ainsi la finesse relative qu'il avait à l'écran.
 *
 * Traiter cette valeur comme une fraction de la largeur, ce que faisait ce module,
 * revenait à lire « 3 » comme « trois fois la largeur du média » : un trait de 2217 px
 * sur une image large de 739, soit un aplat de couleur recouvrant toute la frame.
 */
const REFERENCE_WIDTH = 1280;

/** Épaisseur de trait à l'échelle de l'image rendue. */
const strokeWidth = (shape: AnnotationShape, width: number): number =>
  Math.max(1, num(shape.width, DEFAULT_STROKE_PX) * (width / REFERENCE_WIDTH));

/**
 * Hauteur de police, en fraction de la hauteur du média puis en pixels — même formule
 * que `textFontSize` côté viewer, pour que le texte ait la taille qu'on lui a donnée.
 */
const fontSize = (shape: AnnotationShape, height: number): number =>
  Math.max(8, (0.02 + num(shape.width, DEFAULT_STROKE_PX) * 0.005) * height);

function shapeToSvg(shape: AnnotationShape, w: number, h: number): string {
  // Les trois valeurs ci-dessous sont les seules du rendu à ne pas naître d'un calcul :
  // elles sont donc contraintes ici, à la source, et non échappées plus loin.
  const color = safeColor(shape.color);
  const sw = strokeWidth(shape, w);
  const opacity = clamp(num(shape.alpha, 1), 0, 1);
  const common = `stroke="${color}" stroke-width="${sw}" fill="none" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"`;

  switch (shape.type) {
    case 'path':
    case 'polygon': {
      // Un point n'est pas forcément une paire : déstructurer une valeur non itérable
      // (un nombre, un objet) lèverait une exception au milieu de l'export.
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
      // Pointe dessinée à la main : un marqueur SVG hérite mal de la couleur d'un trait
      // à travers les convertisseurs, et la flèche perdrait sa tête à la conversion.
      // Mêmes proportions que le viewer (`arrowHead`), bornées par la longueur du trait :
      // sans cette borne, une flèche courte est avalée par sa propre pointe.
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
      // `text` peut n'être pas une chaîne : appeler `replace` dessus ferait tomber
      // l'export entier en 500 plutôt que d'ignorer une forme mal formée.
      const label = typeof shape.text === 'string' ? shape.text : '';
      return `<text x="${num(shape.x, 0) * w}" y="${num(shape.y, 0) * h}" fill="${color}" opacity="${opacity}" font-size="${size}" font-family="sans-serif">${escapeXml(label)}</text>`;
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
  // Les dimensions viennent de l'appelant, pas du client — on les borne quand même :
  // un `NaN` dans le viewBox produit un document que ni ffmpeg ni le navigateur ne lit.
  const w = Math.max(1, Math.round(num(width, 0)));
  const h = Math.max(1, Math.round(num(height, 0)));
  const body = shapes.map((s) => shapeToSvg(s, w, h)).join('');
  if (!body) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
