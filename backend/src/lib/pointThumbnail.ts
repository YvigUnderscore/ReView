// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { deflateSync } from 'node:zlib';

import type { PointCloud } from './splatPoints';

/**
 * Point-cloud rasteriser → RGBA PNG, with no dependency at all.
 *
 * It does not aim to render Gaussians: a list thumbnail is 200 px square on screen, and projecting the coloured centres as
 * one- or two-pixel discs gives exactly the same silhouette. The background stays **transparent** — the tile takes the colour
 * of the theme, whatever the theme.
 *
 * Occlusion by depth buffer (the nearest point wins the pixel) rather than by sorting: it is linear, and sorting several
 * hundred thousand indices would cost more than the rest of the rendering.
 */

export interface PointThumbnailOptions {
  /** Side of the square image produced. */
  size?: number;
  /** Rotation around the vertical axis, in degrees (three-quarter view by default). */
  azimuthDeg?: number;
  /** Camera elevation above the horizon, in degrees. */
  elevationDeg?: number;
  /** Disc radius in pixels; inferred from the density of the cloud if absent. */
  radiusPx?: number;
}

export const DEFAULT_THUMB_SIZE = 512;
const DEFAULT_AZIMUTH = 35;
const DEFAULT_ELEVATION = 22;
/** Share of the side occupied by the cloud: the rest is the margin around the subject. */
const FILL_RATIO = 0.86;
/** Framing quantile: a few outlier splats must not zoom out the whole view. */
const TRIM_QUANTILE = 0.005;
/** Sample large enough to estimate a quantile — no need to sort the whole cloud. */
const QUANTILE_SAMPLE = 20_000;

/** Low/high quantile of a series, estimated on a regular sample. */
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

/** Projects the cloud onto the camera plane (orthographic projection: no distortion). */
export function project(cloud: PointCloud, azimuthDeg: number, elevationDeg: number): Projection {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  // Camera → subject direction, and the associated screen frame (world Y up).
  const dx = Math.sin(az) * Math.cos(el);
  const dy = Math.sin(el);
  const dz = Math.cos(az) * Math.cos(el);
  const rx = Math.cos(az);
  const rz = -Math.sin(az);
  // up = d × r, unit by construction (d and r are, and are orthogonal).
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

/** Disc radius that closes the cloud without clogging it, according to its density on screen. */
export function autoRadius(size: number, count: number): number {
  if (count <= 0) return 1;
  const perPoint = (size * size) / count;
  return Math.min(3, Math.max(1, Math.round(Math.sqrt(perPoint) * 0.6)));
}

/**
 * Renders the cloud as a square RGBA PNG, transparent background. Returns `null` if the cloud is empty or degenerate
 * (all points coincide): there is then nothing to show.
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
    // Depth shading: without it, a monochrome cloud comes out as an unreadable flat fill.
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

/** Encodes an 8-bit RGBA image as PNG (filter 0, a single zlib pass) — no dependency. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type "None"
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
