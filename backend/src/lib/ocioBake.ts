// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';

/**
 * Baking of display 3D LUTs (OCIO). **Pure** module: input = display/view names, output = `.cube` text (Iridas/Resolve).
 * No dependency on MinIO or Prisma.
 *
 * Two paths coexist in the product and produce **the same format**:
 *  1. `ociobakelut` / PyOpenColorIO on the worker side (see `workers/ocio/bakeRunner.ts`) — exact for any config,
 *     including **tone-mapped** views (ACES RRT + ODT);
 *  2. the **built-in** fallback of this file — also exact, but **only** for purely colorimetric views (`Raw`,
 *     `Un-tone-mapped`, `Log`). It **refuses** to produce a LUT for a tone-mapped view rather than approximating its
 *     curve: an image judged on an approximation of the RRT is worth less than no transform at all.
 *
 * Domain convention (identical to `ociobakelut --displayview --inputspace`): the LUT input is the **encoded input code in
 * [0,1]** (sRGB texture by default, what a review JPEG/PNG contains) and the output is the **display code**. The viewer
 * therefore applies: decode → exposure → re-encode → LUT → display gamma.
 */

/** Chromaticity coordinates of a set of primaries + its white. */
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

/** Transfer function of a space (code ↔ linear encoding). */
export type Transfer =
  { kind: 'linear' } | { kind: 'srgb' } | { kind: 'gamma'; g: number } | { kind: 'acescct' };

/** A colour space = primaries + a transfer function. */
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

/** Default input space: what a review JPEG/PNG contains (sRGB texture). */
export const SRGB_TEXTURE: ColorSpaceSpec = { primaries: PRIMARIES.sRGB, transfer: { kind: 'srgb' } };

/**
 * Candidate names of this space **in an OCIO config**, from most recent to oldest: the ACES configs called it
 * `Utility - sRGB - Texture` (1.x), `sRGB - Texture` (studio 2.x) and `srgb_tx` (CG alias). `bake_lut.py` keeps the first
 * one that exists.
 */
export const SRGB_TEXTURE_NAMES = [
  'sRGB - Texture',
  'srgb_tx',
  'Utility - sRGB - Texture',
  'Input - Generic - sRGB - Texture',
  'sRGB',
] as const;

/** List of candidates in the form expected by `bake_lut.py --inputspace`. */
export const SRGB_TEXTURE_NAME = SRGB_TEXTURE_NAMES.join(';');

/** Grid size of the baked LUTs (33³ = Resolve/Iridas convention). */
export const LUT_SIZE = 33;

// 3×3 algebra (row-major)
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

/** RGB→XYZ matrix of a set of primaries (standard method SMPTE RP 177). */
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

/** Bradford chromatic adaptation between two whites (xy). */
export function bradford(from: { x: number; y: number }, to: { x: number; y: number }): number[] {
  const src = applyMat(BRADFORD, [from.x / from.y, 1, (1 - from.x - from.y) / from.y]);
  const dst = applyMat(BRADFORD, [to.x / to.y, 1, (1 - to.x - to.y) / to.y]);
  const scale = [dst[0] / src[0], 0, 0, 0, dst[1] / src[1], 0, 0, 0, dst[2] / src[2]];
  return mul(invert(BRADFORD), mul(scale, BRADFORD));
}

/** Linear matrix `src` → `dst` (white adaptation included). */
export function primariesMatrix(src: Chromaticities, dst: Chromaticities): number[] {
  const cat = bradford({ x: src.wx, y: src.wy }, { x: dst.wx, y: dst.wy });
  return mul(invert(rgbToXyz(dst)), mul(cat, rgbToXyz(src)));
}

// Transfer functions
const CCT_A = 10.5402377416545;
const CCT_B = 0.0729055341958355;
const CCT_BREAK = 0.0078125;

/** Encoded code → linear. */
export function decode(tf: Transfer, v: number): number {
  if (tf.kind === 'linear') return v;
  if (tf.kind === 'gamma') return v <= 0 ? 0 : Math.pow(v, tf.g);
  if (tf.kind === 'srgb') return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  // ACEScct
  return v <= CCT_A * CCT_BREAK + CCT_B ? (v - CCT_B) / CCT_A : Math.pow(2, v * 17.52 - 9.72);
}

/** Linear → encoded code. */
export function encode(tf: Transfer, v: number): number {
  if (tf.kind === 'linear') return v;
  if (tf.kind === 'gamma') return v <= 0 ? 0 : Math.pow(v, 1 / tf.g);
  if (tf.kind === 'srgb')
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  return v <= CCT_BREAK ? CCT_A * v + CCT_B : (Math.log2(Math.max(v, 1e-10)) + 9.72) / 17.52;
}

// Recognition of the displays / views of an ACES config

/** Displays recognised by the built-in fallback (HDR displays are deliberately not listed). */
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

/** Colour space of a named display, or `null` if it is not recognised (HDR, DCI…). */
export function displaySpace(display: string): ColorSpaceSpec | null {
  return KNOWN_DISPLAYS.find((d) => d.re.test(display.trim()))?.space ?? null;
}

/**
 * Nature of a view:
 * - `raw`: codes are sent as-is;
 * - `colorimetric`: gamut conversion + display encoding, without rendering curve;
 * - `log`: ACEScct encoding (value inspection);
 * - `tonemapped`: ACES RRT/ODT — out of reach of the built-in fallback.
 */
export type ViewKind = 'raw' | 'colorimetric' | 'log' | 'tonemapped';

export function viewKind(view: string): ViewKind {
  const v = view.trim().toLowerCase();
  if (v === 'raw' || v === 'none') return 'raw';
  if (v.includes('un-tone-mapped') || v.includes('untone') || v === 'unmapped') return 'colorimetric';
  if (v === 'log' || v.includes('acescct') || v.includes('acescc')) return 'log';
  return 'tonemapped';
}

/** True if the built-in fallback can bake this pair **exactly**. */
export function isBuiltinBakeable(display: string, view: string): boolean {
  const kind = viewKind(view);
  if (kind === 'tonemapped') return false;
  if (kind === 'raw' || kind === 'log') return true;
  return displaySpace(display) !== null;
}

// Baking

/** Data of a 3D LUT: `size³` triplets, red varying fastest. */
export interface CubeLut {
  size: number;
  data: Float32Array;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Bakes the LUT of a display/view pair with the built-in fallback. Returns `null` if the view requires a rendering curve
 * (RRT/ODT) or if the display is not recognised: it is then up to the OCIO worker to produce the LUT.
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
 * Provenance line written at the head of the `.cube`. The viewer rereads it to show on screen **where** the transform it
 * applies comes from: the same LUT baked by OCIO or by the built-in fallback is not worth the same to a supervisor.
 * `bake_lut.py` writes the same form.
 */
export const CUBE_SOURCE_PREFIX = '# ReView display transform | source:';
export const BUILTIN_SOURCE = 'built-in colorimetric';

/** Serialises a LUT in `.cube` format (Iridas), readable by Resolve, Nuke and the viewer. */
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

/** Maximum number of entries accepted when reading a `.cube` (65³ ≈ 275,000). */
const MAX_CUBE_SIZE = 65;

/** Parses a `.cube` (3D only). Throws if the announced size and the content diverge. */
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

/** Stable storage identifier of a display/view pair (readable name + short digest). */
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

/** MinIO key of a baked LUT — stored **next to** the `.ocio`, under the config's folder. */
export const lutStorageKey = (configId: string, display: string, view: string): string =>
  `studio/ocio/luts/${configId}/${lutSlug(display, view)}.cube`;

/** MinIO prefix of all the LUTs of a config (purged on uninstall). */
export const lutPrefix = (configId: string): string => `studio/ocio/luts/${configId}/`;
