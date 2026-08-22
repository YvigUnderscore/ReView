// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { deflateSync } from 'node:zlib';

import type { PointCloud } from './splatPoints';

/**
 * Rasteriseur de nuage de points → PNG RGBA, sans aucune dépendance.
 *
 * Il ne s'agit pas de rendre des gaussiennes : une vignette de liste fait 200 px de côté à
 * l'écran, projeter les centres coloriés en disques d'un ou deux pixels donne exactement la
 * même silhouette. Le fond reste **transparent** — la tuile prend la couleur du thème, quel
 * que soit le thème.
 *
 * Occlusion par tampon de profondeur (le point le plus proche gagne le pixel) plutôt que par
 * tri : c'est linéaire, et un tri de plusieurs centaines de milliers d'index coûterait plus
 * cher que tout le reste du rendu.
 */

export interface PointThumbnailOptions {
  /** Côté de l'image carrée produite. */
  size?: number;
  /** Rotation autour de l'axe vertical, en degrés (vue de trois quarts par défaut). */
  azimuthDeg?: number;
  /** Élévation de la caméra au-dessus de l'horizon, en degrés. */
  elevationDeg?: number;
  /** Rayon des disques en pixels ; déduit de la densité du nuage si absent. */
  radiusPx?: number;
}

export const DEFAULT_THUMB_SIZE = 512;
const DEFAULT_AZIMUTH = 35;
const DEFAULT_ELEVATION = 22;
/** Part du côté occupée par le nuage : le reste est la marge autour du sujet. */
const FILL_RATIO = 0.86;
/** Quantile de recadrage : quelques splats aberrants ne doivent pas dézoomer toute la vue. */
const TRIM_QUANTILE = 0.005;
/** Échantillon suffisant pour estimer un quantile — inutile de trier tout le nuage. */
const QUANTILE_SAMPLE = 20_000;

/** Quantile bas/haut d'une série, estimé sur un échantillon régulier. */
export function robustRange(values: Float32Array, count: number, quantile = TRIM_QUANTILE): [number, number] {
  if (count <= 0) return [0, 0];
  const step = Math.max(1, Math.ceil(count / QUANTILE_SAMPLE));
  const sample: number[] = [];
  for (let i = 0; i < count; i += step) sample.push(values[i]!);
  sample.sort((a, b) => a - b);
  const last = sample.length - 1;
  const lo = sample[Math.min(last, Math.floor(last * quantile))]!;
  const hi = sample[Math.max(0, Math.ceil(last * (1 - quantile)))]!;
  return [lo, hi];
}

interface Projection {
  u: Float32Array;
  v: Float32Array;
  depth: Float32Array;
}

/** Projette le nuage sur le plan caméra (projection orthographique : aucune déformation). */
export function project(cloud: PointCloud, azimuthDeg: number, elevationDeg: number): Projection {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  // Direction caméra → sujet, et repère écran associé (Y monde vers le haut).
  const dx = Math.sin(az) * Math.cos(el);
  const dy = Math.sin(el);
  const dz = Math.cos(az) * Math.cos(el);
  const rx = Math.cos(az);
  const rz = -Math.sin(az);
  // up = d × r, unitaire par construction (d et r le sont et sont orthogonaux).
  const ux = dy * rz;
  const uy = dz * rx - dx * rz;
  const uz = -dy * rx;

  const n = cloud.count;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const depth = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = cloud.positions[i * 3]!;
    const y = cloud.positions[i * 3 + 1]!;
    const z = cloud.positions[i * 3 + 2]!;
    u[i] = x * rx + z * rz;
    v[i] = x * ux + y * uy + z * uz;
    depth[i] = x * dx + y * dy + z * dz;
  }
  return { u, v, depth };
}

/** Rayon de disque qui referme le nuage sans l'empâter, d'après sa densité à l'écran. */
export function autoRadius(size: number, count: number): number {
  if (count <= 0) return 1;
  const perPoint = (size * size) / count;
  return Math.min(3, Math.max(1, Math.round(Math.sqrt(perPoint) * 0.6)));
}

/**
 * Rend le nuage en PNG RGBA carré, fond transparent. Renvoie `null` si le nuage est vide ou
 * dégénéré (tous les points confondus) : il n'y a alors rien à montrer.
 */
export function renderPointCloudPng(cloud: PointCloud, opts: PointThumbnailOptions = {}): Buffer | null {
  const size = Math.max(32, Math.round(opts.size ?? DEFAULT_THUMB_SIZE));
  if (cloud.count <= 0) return null;

  const { u, v, depth } = project(
    cloud,
    opts.azimuthDeg ?? DEFAULT_AZIMUTH,
    opts.elevationDeg ?? DEFAULT_ELEVATION,
  );
  const [uLo, uHi] = robustRange(u, cloud.count);
  const [vLo, vHi] = robustRange(v, cloud.count);
  const span = Math.max(uHi - uLo, vHi - vLo);
  if (!(span > 0) || !Number.isFinite(span)) return null;

  const scale = (size * FILL_RATIO) / span;
  const cu = (uLo + uHi) / 2;
  const cv = (vLo + vHi) / 2;
  const [dLo, dHi] = robustRange(depth, cloud.count);
  const dSpan = dHi - dLo || 1;

  const rgba = new Uint8Array(size * size * 4);
  const zbuf = new Float32Array(size * size).fill(-Infinity);
  const radius = Math.max(0, Math.round(opts.radiusPx ?? autoRadius(size, cloud.count)));
  const r2 = (radius + 0.35) * (radius + 0.35);

  for (let i = 0; i < cloud.count; i += 1) {
    const px = Math.round(size / 2 + (u[i]! - cu) * scale);
    const py = Math.round(size / 2 - (v[i]! - cv) * scale);
    if (px < -radius || py < -radius || px > size + radius || py > size + radius) continue;
    const d = depth[i]!;
    // Ombrage de profondeur : sans lui, un nuage monochrome ressort en aplat illisible.
    const shade = 0.72 + 0.28 * Math.min(1, Math.max(0, (d - dLo) / dSpan));
    const cr = Math.min(255, cloud.colors[i * 3]! * shade);
    const cg = Math.min(255, cloud.colors[i * 3 + 1]! * shade);
    const cb = Math.min(255, cloud.colors[i * 3 + 2]! * shade);

    for (let oy = -radius; oy <= radius; oy += 1) {
      const y = py + oy;
      if (y < 0 || y >= size) continue;
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (ox * ox + oy * oy > r2) continue;
        const x = px + ox;
        if (x < 0 || x >= size) continue;
        const at = y * size + x;
        if (d <= zbuf[at]!) continue;
        zbuf[at] = d;
        rgba[at * 4] = cr;
        rgba[at * 4 + 1] = cg;
        rgba[at * 4 + 2] = cb;
        rgba[at * 4 + 3] = 255;
      }
    }
  }

  return encodePng(rgba, size, size);
}

// ---------------------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode une image RGBA 8 bits en PNG (filtre 0, une passe zlib) — aucune dépendance. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // type de filtre « None »
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // couleur : RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
