// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import type { Readable } from 'node:stream';

/**
 * Lecture **échantillonnée** d'un fichier gaussian splat pour en tirer un nuage de points
 * (position + couleur) exploitable par le rasteriseur de vignettes (`lib/pointThumbnail`).
 *
 * Pourquoi maison : aucun moteur de rendu headless ne lit les gaussiennes. Blender ne les
 * connaît pas, et la seule autre option honnête serait d'attendre qu'un humain ouvre la
 * review pour capturer le canvas. Or un splat n'a pas besoin d'être *rendu* pour donner une
 * vignette lisible : projeter quelques dizaines de milliers de centres coloriés suffit
 * largement à reconnaître l'objet dans une liste.
 *
 * Le fichier n'est jamais chargé en mémoire : on lit l'en-tête, puis on parcourt les
 * enregistrements en flux en n'en retenant qu'un sur `step`. Un splat de 2 Go se lit donc
 * sans pic mémoire.
 *
 * Formats couverts : `.ply` binaire (le format de sortie de tous les entraîneurs) et
 * `.splat` (32 octets par splat). **Volontairement pas** `.spz`, `.ksplat`, `.sog`/`.sogs` :
 * conteneurs compressés dont une lecture approximative produirait une image fausse sans
 * qu'on s'en aperçoive — mieux vaut ne pas enfiler le travail (cf. `spatialThumbSource`).
 */

/** Conteneurs de splat dont on sait extraire un nuage de points. */
export const SPLAT_PREVIEW_EXTENSIONS = ['.ply', '.splat'] as const;

export const isSplatPreviewSupported = (ext: string): boolean =>
  (SPLAT_PREVIEW_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());

/** En-tête PLY lu au plus sur cette taille : au-delà, le fichier n'est pas un PLY sain. */
export const PLY_HEADER_MAX_BYTES = 128 * 1024;

/** Coefficient SH degré 0 — `f_dc_*` est un coefficient, pas une couleur. */
export const SH_C0 = 0.28209479177387814;

/** En-dessous, la gaussienne est transparente : la retenir salirait la vignette. */
export const MIN_VISIBLE_ALPHA = 0.12;

/** Nuage échantillonné : positions XYZ (3 flottants/point) et couleurs RGB (3 octets/point). */
export interface PointCloud {
  count: number;
  positions: Float32Array;
  colors: Uint8Array;
}

type PlyScalar = 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64';

const SCALAR_BYTES: Record<PlyScalar, number> = {
  i8: 1,
  u8: 1,
  i16: 2,
  u16: 2,
  i32: 4,
  u32: 4,
  f32: 4,
  f64: 8,
};

const PLY_TYPES: Record<string, PlyScalar> = {
  char: 'i8',
  int8: 'i8',
  uchar: 'u8',
  uint8: 'u8',
  short: 'i16',
  int16: 'i16',
  ushort: 'u16',
  uint16: 'u16',
  int: 'i32',
  int32: 'i32',
  uint: 'u32',
  uint32: 'u32',
  float: 'f32',
  float32: 'f32',
  double: 'f64',
  float64: 'f64',
};

interface FieldRef {
  offset: number;
  type: PlyScalar;
}

/** Description d'un enregistrement binaire à taille fixe : de quoi lire un point. */
export interface SplatLayout {
  rowBytes: number;
  dataOffset: number;
  count: number;
  littleEndian: boolean;
  pos: [FieldRef, FieldRef, FieldRef];
  /** Couleur déjà en octets (PLY `red/green/blue`, `.splat`). */
  rgb: [FieldRef, FieldRef, FieldRef] | null;
  /** Couleur en coefficients SH degré 0 (`f_dc_*`), forme usuelle des gaussiennes. */
  dc: [FieldRef, FieldRef, FieldRef] | null;
  alpha: FieldRef | null;
  /** `logit` : opacité gaussienne (sigmoïde à appliquer) ; `byte` : 0-255 direct. */
  alphaScale: 'logit' | 'byte';
}

export type PlyHeaderResult = { ok: true; layout: SplatLayout } | { ok: false; reason: string };

function readScalar(buf: Buffer, off: number, type: PlyScalar, le: boolean): number {
  switch (type) {
    case 'i8':
      return buf.readInt8(off);
    case 'u8':
      return buf.readUInt8(off);
    case 'i16':
      return le ? buf.readInt16LE(off) : buf.readInt16BE(off);
    case 'u16':
      return le ? buf.readUInt16LE(off) : buf.readUInt16BE(off);
    case 'i32':
      return le ? buf.readInt32LE(off) : buf.readInt32BE(off);
    case 'u32':
      return le ? buf.readUInt32LE(off) : buf.readUInt32BE(off);
    case 'f32':
      return le ? buf.readFloatLE(off) : buf.readFloatBE(off);
    case 'f64':
      return le ? buf.readDoubleLE(off) : buf.readDoubleBE(off);
  }
}

const clamp255 = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

/** Un point lu dans un enregistrement, couleur normalisée en octets et alpha en 0→1. */
export interface SplatPoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Lit un enregistrement complet à l'offset donné. */
export function readPoint(buf: Buffer, at: number, layout: SplatLayout): SplatPoint {
  const le = layout.littleEndian;
  const f = (ref: FieldRef): number => readScalar(buf, at + ref.offset, ref.type, le);
  const [px, py, pz] = layout.pos;
  let r = 200;
  let g = 200;
  let b = 200;
  if (layout.rgb) {
    r = clamp255(f(layout.rgb[0]));
    g = clamp255(f(layout.rgb[1]));
    b = clamp255(f(layout.rgb[2]));
  } else if (layout.dc) {
    r = clamp255((0.5 + SH_C0 * f(layout.dc[0])) * 255);
    g = clamp255((0.5 + SH_C0 * f(layout.dc[1])) * 255);
    b = clamp255((0.5 + SH_C0 * f(layout.dc[2])) * 255);
  }
  let a = 1;
  if (layout.alpha) {
    const raw = f(layout.alpha);
    a = layout.alphaScale === 'byte' ? raw / 255 : 1 / (1 + Math.exp(-raw));
  }
  return { x: f(px), y: f(py), z: f(pz), r, g, b, a };
}

/**
 * Analyse l'en-tête d'un PLY et décrit l'enregistrement de l'élément `vertex`.
 *
 * Refus explicites (avec motif, pour que le worker le journalise) : PLY ASCII, PLY compressé
 * PlayCanvas (élément `chunk` + positions empaquetées), propriété de type liste dans les
 * sommets — dans les trois cas la taille d'enregistrement n'est pas fixe ou les valeurs ne
 * sont pas celles qu'on croit lire.
 */
export function parsePlyHeader(head: Buffer): PlyHeaderResult {
  if (head.length < 4 || head.subarray(0, 3).toString('latin1') !== 'ply')
    return { ok: false, reason: 'not-a-ply' };
  const text = head.subarray(0, Math.min(head.length, PLY_HEADER_MAX_BYTES)).toString('latin1');
  const marker = text.indexOf('end_header');
  if (marker < 0) return { ok: false, reason: 'header-truncated' };
  const eol = text.indexOf('\n', marker);
  if (eol < 0) return { ok: false, reason: 'header-truncated' };
  const dataOffset = eol + 1;

  const lines = text
    .slice(0, marker)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let littleEndian = true;
  let element: string | null = null;
  let count = 0;
  let rowBytes = 0;
  const props = new Map<string, FieldRef>();

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') {
      const fmt = parts[1] ?? '';
      if (fmt === 'ascii') return { ok: false, reason: 'ascii-ply' };
      if (fmt !== 'binary_little_endian' && fmt !== 'binary_big_endian')
        return { ok: false, reason: `unknown-format:${fmt}` };
      littleEndian = fmt === 'binary_little_endian';
    } else if (parts[0] === 'element') {
      element = parts[1] ?? null;
      // Un élément `chunk` signe un PLY compressé PlayCanvas : les positions y sont
      // empaquetées par blocs, les lire comme des flottants donnerait un nuage aberrant.
      if (element === 'chunk') return { ok: false, reason: 'compressed-ply' };
      if (element === 'vertex') count = Number(parts[2] ?? 0);
    } else if (parts[0] === 'property' && element === 'vertex') {
      if (parts[1] === 'list') return { ok: false, reason: 'list-property' };
      const type = PLY_TYPES[parts[1] ?? ''];
      const name = parts[2] ?? '';
      if (!type) return { ok: false, reason: `unknown-type:${String(parts[1])}` };
      props.set(name, { offset: rowBytes, type });
      rowBytes += SCALAR_BYTES[type];
    }
  }

  if (!Number.isFinite(count) || count <= 0) return { ok: false, reason: 'no-vertex' };
  const pos = ['x', 'y', 'z'].map((n) => props.get(n));
  if (!pos[0] || !pos[1] || !pos[2]) return { ok: false, reason: 'no-position' };

  const rgbNames = props.has('red') ? ['red', 'green', 'blue'] : ['r', 'g', 'b'];
  const rgb = rgbNames.map((n) => props.get(n));
  const dc = ['f_dc_0', 'f_dc_1', 'f_dc_2'].map((n) => props.get(n));

  return {
    ok: true,
    layout: {
      rowBytes,
      dataOffset,
      count,
      littleEndian,
      pos: [pos[0], pos[1], pos[2]],
      rgb: rgb[0] && rgb[1] && rgb[2] ? [rgb[0], rgb[1], rgb[2]] : null,
      dc: dc[0] && dc[1] && dc[2] ? [dc[0], dc[1], dc[2]] : null,
      alpha: props.get('opacity') ?? props.get('alpha') ?? null,
      alphaScale: props.has('opacity') ? 'logit' : 'byte',
    },
  };
}

/** Enregistrement du format `.splat` (antimatter15) : 32 octets, position + échelle + RGBA + quaternion. */
export function splatLayout(fileSize: number): SplatLayout | null {
  if (fileSize <= 0 || fileSize % 32 !== 0) return null;
  return {
    rowBytes: 32,
    dataOffset: 0,
    count: fileSize / 32,
    littleEndian: true,
    pos: [
      { offset: 0, type: 'f32' },
      { offset: 4, type: 'f32' },
      { offset: 8, type: 'f32' },
    ],
    rgb: [
      { offset: 24, type: 'u8' },
      { offset: 25, type: 'u8' },
      { offset: 26, type: 'u8' },
    ],
    dc: null,
    alpha: { offset: 27, type: 'u8' },
    alphaScale: 'byte',
  };
}

/** Un point sur `step` est retenu : le pas qui ramène `count` sous `maxPoints`. */
export const samplingStep = (count: number, maxPoints: number): number =>
  count <= maxPoints || maxPoints <= 0 ? 1 : Math.ceil(count / maxPoints);

/**
 * Parcourt le flux d'enregistrements et retient un point sur `step`, en écartant les
 * gaussiennes trop transparentes. Le flux est consommé jusqu'au dernier point utile puis
 * abandonné : inutile de lire la queue du fichier quand l'échantillon est complet.
 */
export async function collectPoints(
  stream: Readable,
  layout: SplatLayout,
  maxPoints: number,
): Promise<PointCloud> {
  const step = samplingStep(layout.count, maxPoints);
  const capacity = Math.ceil(layout.count / step);
  const positions = new Float32Array(capacity * 3);
  const colors = new Uint8Array(capacity * 3);
  let kept = 0;
  let row = 0;
  let leftover: Buffer = Buffer.alloc(0);

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const buf: Buffer = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
    let off = 0;
    while (off + layout.rowBytes <= buf.length && row < layout.count) {
      if (row % step === 0 && kept < capacity) {
        const p = readPoint(buf, off, layout);
        if (
          p.a >= MIN_VISIBLE_ALPHA &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          Number.isFinite(p.z)
        ) {
          positions[kept * 3] = p.x;
          positions[kept * 3 + 1] = p.y;
          positions[kept * 3 + 2] = p.z;
          colors[kept * 3] = p.r;
          colors[kept * 3 + 1] = p.g;
          colors[kept * 3 + 2] = p.b;
          kept += 1;
        }
      }
      row += 1;
      off += layout.rowBytes;
    }
    leftover = buf.subarray(off);
    if (row >= layout.count) break;
  }
  stream.destroy();

  return { count: kept, positions: positions.subarray(0, kept * 3), colors: colors.subarray(0, kept * 3) };
}

export type SplatReadResult = { ok: true; cloud: PointCloud } | { ok: false; reason: string };

/**
 * Lit un fichier splat sur disque et en tire un nuage échantillonné.
 * Ne lève jamais pour un fichier inexploitable : le motif est renvoyé, le worker le journalise
 * et le média reste simplement sans vignette.
 */
export async function readSplatCloud(
  path: string,
  ext: string,
  fileSize: number,
  maxPoints: number,
): Promise<SplatReadResult> {
  let layout: SplatLayout;
  const lower = ext.toLowerCase();

  if (lower === '.splat') {
    const fixed = splatLayout(fileSize);
    if (!fixed) return { ok: false, reason: 'splat-size-not-multiple-of-32' };
    layout = fixed;
  } else if (lower === '.ply') {
    const handle = await open(path, 'r');
    try {
      const head = Buffer.alloc(Math.min(fileSize, PLY_HEADER_MAX_BYTES));
      await handle.read(head, 0, head.length, 0);
      const parsed = parsePlyHeader(head);
      if (!parsed.ok) return { ok: false, reason: parsed.reason };
      layout = parsed.layout;
    } finally {
      await handle.close();
    }
  } else {
    return { ok: false, reason: `unsupported-extension:${lower}` };
  }

  const cloud = await collectPoints(createReadStream(path, { start: layout.dataOffset }), layout, maxPoints);
  if (cloud.count === 0) return { ok: false, reason: 'no-visible-point' };
  return { ok: true, cloud };
}
