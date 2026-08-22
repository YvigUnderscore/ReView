// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

/**
 * Cuisson des LUT 3D d'affichage (OCIO). Module **pur** : entrée = noms de display/view,
 * sortie = texte `.cube` (Iridas/Resolve). Aucune dépendance à MinIO ni à Prisma.
 *
 * Deux voies coexistent dans le produit et produisent **le même format** :
 *  1. `ociobakelut` / PyOpenColorIO côté worker (voir `workers/ocio/bakeRunner.ts`) — exact
 *     pour n'importe quelle config, y compris les vues **tone-mappées** (RRT + ODT ACES) ;
 *  2. le repli **intégré** de ce fichier — exact lui aussi, mais **seulement** pour les vues
 *     purement colorimétriques (`Raw`, `Un-tone-mapped`, `Log`). Il **refuse** de produire
 *     une LUT pour une vue tone-mappée plutôt que d'en approcher la courbe : une image
 *     jugée sur une approximation du RRT vaut moins que pas de transformée du tout.
 *
 * Convention de domaine (identique à `ociobakelut --displayview --inputspace`) :
 * l'entrée de la LUT est le **code d'entrée encodé dans [0,1]** (sRGB texture par défaut,
 * ce que contient un JPEG/PNG de review) et la sortie est le **code d'affichage**. Le
 * viewer applique donc : décodage → exposition → ré-encodage → LUT → gamma d'affichage.
 */

/** Coordonnées chromatiques d'un jeu de primaires + son blanc. */
export interface Chromaticities {
  rx: number;
  ry: number;
  gx: number;
  gy: number;
  bx: number;
  by: number;
  wx: number;
  wy: number;
}

/** Fonction de transfert d'un espace (encodage code ↔ linéaire). */
export type Transfer =
  { kind: 'linear' } | { kind: 'srgb' } | { kind: 'gamma'; g: number } | { kind: 'acescct' };

/** Un espace couleur = des primaires + une fonction de transfert. */
export interface ColorSpaceSpec {
  primaries: Chromaticities;
  transfer: Transfer;
}

export const PRIMARIES = {
  sRGB: { rx: 0.64, ry: 0.33, gx: 0.3, gy: 0.6, bx: 0.15, by: 0.06, wx: 0.3127, wy: 0.329 },
  p3d65: { rx: 0.68, ry: 0.32, gx: 0.265, gy: 0.69, bx: 0.15, by: 0.06, wx: 0.3127, wy: 0.329 },
  p3d60: { rx: 0.68, ry: 0.32, gx: 0.265, gy: 0.69, bx: 0.15, by: 0.06, wx: 0.32168, wy: 0.33767 },
  rec2020: { rx: 0.708, ry: 0.292, gx: 0.17, gy: 0.797, bx: 0.131, by: 0.046, wx: 0.3127, wy: 0.329 },
  ap1: { rx: 0.713, ry: 0.293, gx: 0.165, gy: 0.83, bx: 0.128, by: 0.044, wx: 0.32168, wy: 0.33767 },
  ap0: { rx: 0.7347, ry: 0.2653, gx: 0.0, gy: 1.0, bx: 0.0001, by: -0.077, wx: 0.32168, wy: 0.33767 },
} as const satisfies Record<string, Chromaticities>;

/** Espace d'entrée par défaut : ce qu'un JPEG/PNG de review contient (sRGB texture). */
export const SRGB_TEXTURE: ColorSpaceSpec = { primaries: PRIMARIES.sRGB, transfer: { kind: 'srgb' } };

/**
 * Noms candidats de cet espace **dans une config OCIO**, du plus récent au plus ancien : les
 * configs ACES l'ont appelé successivement `Utility - sRGB - Texture` (1.x), `sRGB - Texture`
 * (studio 2.x) et `srgb_tx` (alias CG). `bake_lut.py` retient le premier qui existe.
 */
export const SRGB_TEXTURE_NAMES = [
  'sRGB - Texture',
  'srgb_tx',
  'Utility - sRGB - Texture',
  'Input - Generic - sRGB - Texture',
  'sRGB',
] as const;

/** Liste des candidats sous la forme attendue par `bake_lut.py --inputspace`. */
export const SRGB_TEXTURE_NAME = SRGB_TEXTURE_NAMES.join(';');

/** Taille de grille des LUT cuites (33³ = convention Resolve/Iridas). */
export const LUT_SIZE = 33;

// ---------------------------------------------------------------------------------------
// Algèbre 3×3 (ligne majeure)
// ---------------------------------------------------------------------------------------
export type Mat3 = readonly number[];

const mul = (a: Mat3, b: Mat3): number[] => {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return out;
};

const invert = (m: Mat3): number[] => {
  const [a, b, c, d, e, f, g, h, i] = m as number[] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('singular matrix');
  return [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
};

const applyMat = (m: Mat3, v: readonly number[]): [number, number, number] => [
  m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!,
  m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!,
  m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!,
];

/** Matrice RGB→XYZ d'un jeu de primaires (méthode standard SMPTE RP 177). */
export function rgbToXyz(c: Chromaticities): number[] {
  const zr = 1 - c.rx - c.ry;
  const zg = 1 - c.gx - c.gy;
  const zb = 1 - c.bx - c.by;
  const m = [c.rx / c.ry, c.gx / c.gy, c.bx / c.by, 1, 1, 1, zr / c.ry, zg / c.gy, zb / c.by];
  const w = [c.wx / c.wy, 1, (1 - c.wx - c.wy) / c.wy];
  const s = applyMat(invert(m), w);
  return [
    m[0]! * s[0],
    m[1]! * s[1],
    m[2]! * s[2],
    m[3]! * s[0],
    m[4]! * s[1],
    m[5]! * s[2],
    m[6]! * s[0],
    m[7]! * s[1],
    m[8]! * s[2],
  ];
}

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

/** Adaptation chromatique de Bradford entre deux blancs (xy). */
export function bradford(from: { x: number; y: number }, to: { x: number; y: number }): number[] {
  const src = applyMat(BRADFORD, [from.x / from.y, 1, (1 - from.x - from.y) / from.y]);
  const dst = applyMat(BRADFORD, [to.x / to.y, 1, (1 - to.x - to.y) / to.y]);
  const scale = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  return mul(invert(BRADFORD), mul(scale, BRADFORD));
}

/** Matrice linéaire `src` → `dst` (adaptation du blanc incluse). */
export function primariesMatrix(src: Chromaticities, dst: Chromaticities): number[] {
  const cat = bradford({ x: src.wx, y: src.wy }, { x: dst.wx, y: dst.wy });
  return mul(invert(rgbToXyz(dst)), mul(cat, rgbToXyz(src)));
}

// ---------------------------------------------------------------------------------------
// Fonctions de transfert
// ---------------------------------------------------------------------------------------
const CCT_A = 10.5402377416545;
const CCT_B = 0.0729055341958355;
const CCT_BREAK = 0.0078125;

/** Code encodé → linéaire. */
export function decode(tf: Transfer, v: number): number {
  if (tf.kind === 'linear') return v;
  if (tf.kind === 'gamma') return v <= 0 ? 0 : Math.pow(v, tf.g);
  if (tf.kind === 'srgb') return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  // ACEScct
  return v <= CCT_A * CCT_BREAK + CCT_B ? (v - CCT_B) / CCT_A : Math.pow(2, v * 17.52 - 9.72);
}

/** Linéaire → code encodé. */
export function encode(tf: Transfer, v: number): number {
  if (tf.kind === 'linear') return v;
  if (tf.kind === 'gamma') return v <= 0 ? 0 : Math.pow(v, 1 / tf.g);
  if (tf.kind === 'srgb')
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  return v <= CCT_BREAK ? CCT_A * v + CCT_B : (Math.log2(Math.max(v, 1e-10)) + 9.72) / 17.52;
}

// ---------------------------------------------------------------------------------------
// Reconnaissance des displays / views d'une config ACES
// ---------------------------------------------------------------------------------------

/** Displays reconnus par le repli intégré (les displays HDR n'y figurent pas volontairement). */
const KNOWN_DISPLAYS: { re: RegExp; space: ColorSpaceSpec }[] = [
  { re: /^s?rgb(\s*-\s*display)?$/i, space: SRGB_TEXTURE },
  {
    re: /^display\s*p3(\s*-\s*display)?$/i,
    space: { primaries: PRIMARIES.p3d65, transfer: { kind: 'srgb' } },
  },
  {
    re: /^rec\.?\s*1886\s+rec\.?\s*709(\s*-\s*display)?$/i,
    space: { primaries: PRIMARIES.sRGB, transfer: { kind: 'gamma', g: 2.4 } },
  },
  {
    re: /^rec\.?\s*(1886\s+)?rec\.?\s*2020(\s*-\s*display)?$/i,
    space: { primaries: PRIMARIES.rec2020, transfer: { kind: 'gamma', g: 2.4 } },
  },
  {
    re: /^rec\.?\s*709(\s*-\s*display)?$/i,
    space: { primaries: PRIMARIES.sRGB, transfer: { kind: 'gamma', g: 2.4 } },
  },
  {
    re: /^p3-?d65(\s*-\s*display)?$/i,
    space: { primaries: PRIMARIES.p3d65, transfer: { kind: 'gamma', g: 2.6 } },
  },
  {
    re: /^p3-?d60(\s*-\s*display)?$/i,
    space: { primaries: PRIMARIES.p3d60, transfer: { kind: 'gamma', g: 2.6 } },
  },
];

/** Espace d'affichage d'un display nommé, ou `null` s'il n'est pas reconnu (HDR, DCI…). */
export function displaySpace(display: string): ColorSpaceSpec | null {
  return KNOWN_DISPLAYS.find((d) => d.re.test(display.trim()))?.space ?? null;
}

/**
 * Nature d'une vue :
 * - `raw` : les codes sont envoyés tels quels ;
 * - `colorimetric` : conversion de gamut + encodage d'affichage, sans courbe de rendu ;
 * - `log` : encodage ACEScct (inspection de valeurs) ;
 * - `tonemapped` : RRT/ODT ACES — hors de portée du repli intégré.
 */
export type ViewKind = 'raw' | 'colorimetric' | 'log' | 'tonemapped';

export function viewKind(view: string): ViewKind {
  const v = view.trim().toLowerCase();
  if (v === 'raw' || v === 'none') return 'raw';
  if (v.includes('un-tone-mapped') || v.includes('untone') || v === 'unmapped') return 'colorimetric';
  if (v === 'log' || v.includes('acescct') || v.includes('acescc')) return 'log';
  return 'tonemapped';
}

/** Vrai si le repli intégré sait cuire ce couple **exactement**. */
export function isBuiltinBakeable(display: string, view: string): boolean {
  const kind = viewKind(view);
  if (kind === 'tonemapped') return false;
  if (kind === 'raw' || kind === 'log') return true;
  return displaySpace(display) !== null;
}

// ---------------------------------------------------------------------------------------
// Cuisson
// ---------------------------------------------------------------------------------------

/** Données d'une LUT 3D : `size³` triplets, rouge variant le plus vite. */
export interface CubeLut {
  size: number;
  data: Float32Array;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Cuit la LUT d'un couple display/view avec le repli intégré. Renvoie `null` si la vue
 * demande une courbe de rendu (RRT/ODT) ou si le display n'est pas reconnu : c'est alors au
 * worker OCIO de produire la LUT.
 */
export function bakeBuiltinLut(
  display: string,
  view: string,
  input: ColorSpaceSpec = SRGB_TEXTURE,
  size: number = LUT_SIZE,
): CubeLut | null {
  const kind = viewKind(view);
  if (kind === 'tonemapped') return null;
  const out =
    kind === 'log'
      ? ({ primaries: PRIMARIES.ap1, transfer: { kind: 'acescct' } } satisfies ColorSpaceSpec)
      : kind === 'raw'
        ? input
        : displaySpace(display);
  if (!out) return null;

  const m = primariesMatrix(input.primaries, out.primaries);
  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const lin = [
          decode(input.transfer, r / last),
          decode(input.transfer, g / last),
          decode(input.transfer, b / last),
        ];
        const conv = kind === 'raw' ? (lin as [number, number, number]) : applyMat(m, lin);
        data[i++] = clamp01(encode(out.transfer, conv[0]));
        data[i++] = clamp01(encode(out.transfer, conv[1]));
        data[i++] = clamp01(encode(out.transfer, conv[2]));
      }
  return { size, data };
}

/**
 * Ligne de provenance écrite en tête du `.cube`. Le viewer la relit pour dire à l'écran
 * **d'où vient** la transformée qu'il applique : la même LUT cuite par OCIO ou par le repli
 * intégré ne vaut pas la même chose pour un superviseur. `bake_lut.py` écrit la même forme.
 */
export const CUBE_SOURCE_PREFIX = '# ReView display transform | source:';
export const BUILTIN_SOURCE = 'built-in colorimetric';

/** Sérialise une LUT au format `.cube` (Iridas), lisible par Resolve, Nuke et le viewer. */
export function serializeCube(lut: CubeLut, title: string, source = BUILTIN_SOURCE): string {
  const lines = [
    `${CUBE_SOURCE_PREFIX} ${source.replace(/[\r\n]/g, ' ')}`,
    `TITLE "${title.replace(/["\r\n]/g, '')}"`,
    `LUT_3D_SIZE ${lut.size}`,
    `DOMAIN_MIN 0.0 0.0 0.0`,
    `DOMAIN_MAX 1.0 1.0 1.0`,
  ];
  for (let i = 0; i < lut.data.length; i += 3)
    lines.push(`${lut.data[i]!.toFixed(6)} ${lut.data[i + 1]!.toFixed(6)} ${lut.data[i + 2]!.toFixed(6)}`);
  return `${lines.join('\n')}\n`;
}

/** Nombre maximal d'entrées acceptées à la lecture d'un `.cube` (65³ ≈ 275 000). */
const MAX_CUBE_SIZE = 65;

/** Parse un `.cube` (3D uniquement). Lève si la taille annoncée et le contenu divergent. */
export function parseCube(text: string): CubeLut {
  let size = 0;
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sz = /^LUT_3D_SIZE\s+(\d+)$/i.exec(line);
    if (sz) {
      size = Number(sz[1]);
      if (size < 2 || size > MAX_CUBE_SIZE) throw new Error(`unsupported LUT_3D_SIZE ${size}`);
      continue;
    }
    if (/^[A-Z_]+\s/i.test(line) && !/^[-\d.]/.test(line)) continue; // TITLE, DOMAIN_*, LUT_1D_*
    const parts = line.split(/\s+/).map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) continue;
    values.push(parts[0]!, parts[1]!, parts[2]!);
  }
  if (!size) throw new Error('LUT_3D_SIZE missing');
  if (values.length !== size * size * size * 3)
    throw new Error(`expected ${size ** 3} entries, got ${values.length / 3}`);
  return { size, data: Float32Array.from(values) };
}

/** Identifiant de stockage stable d'un couple display/view (nom lisible + condensé court). */
export function lutSlug(display: string, view: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'x';
  const hash = createHash('sha1').update(`${display} ${view}`).digest('hex').slice(0, 8);
  return `${slug(display)}__${slug(view)}__${hash}`;
}

/** Clé MinIO d'une LUT cuite — rangée **à côté** du `.ocio`, sous le dossier de la config. */
export const lutStorageKey = (configId: string, display: string, view: string): string =>
  `studio/ocio/luts/${configId}/${lutSlug(display, view)}.cube`;

/** Préfixe MinIO de toutes les LUT d'une config (purge à la désinstallation). */
export const lutPrefix = (configId: string): string => `studio/ocio/luts/${configId}/`;
