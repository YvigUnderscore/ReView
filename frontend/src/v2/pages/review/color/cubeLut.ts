// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reads a 3D `.cube` LUT baked by the backend (`lib/ocioBake.ts` or `bake_lut.py`) and shapes it
 * for the GPU. **Pure** module — no WebGL call, no network.
 *
 * Two packings, because there are two generations of context:
 *  - `volume`: RGBA8 in the order expected by `texImage3D` (WebGL2), red varying fastest;
 *  - `tiles`: the same grid unfolded into a **2D atlas** (one blue slice per tile), the WebGL1
 *    fallback where `sampler3D` does not exist.
 *
 * The values of a display LUT are screen codes in [0,1]: storing them in 8 bits adds no visible
 * error for an 8-bit source and an 8-bit output, and avoids depending on floating-point texture
 * filtering.
 */

/** Provenance of the LUT, read from the file header — shown as is to the supervisor. */
export type LutSource = 'ocio' | 'builtin' | 'unknown';

export interface CubeLut {
  size: number;
  /** RGBA8, `size³` texels, red varying fastest. */
  volume: Uint8Array;
  source: LutSource;
}

/** Maximum accepted size (65³ ≈ 275,000 entries) — beyond it, the file is rejected. */
export const MAX_LUT_SIZE = 65;

const SOURCE_RE = /^#\s*ReView display transform\s*\|\s*source:\s*(.+)$/i;

/** Infers the provenance from the header line written by the backend. */
export function readSource(text: string): LutSource {
  for (const line of text.split(/\r?\n/, 8)) {
    const m = SOURCE_RE.exec(line.trim());
    if (!m?.[1]) continue;
    return /opencolorio/i.test(m[1]) ? 'ocio' : 'builtin';
  }
  return 'unknown';
}

const toByte = (v: number): number => {
  const n = Math.round(v * 255);
  return n < 0 ? 0 : n > 255 ? 255 : n;
};

/**
 * Parses a 3D `.cube`. Throws on a truncated file: better to show "transform unavailable" than to
 * sample an incomplete grid.
 */
export function parseCubeLut(text: string): CubeLut {
  let size = 0;
  let volume: Uint8Array | null = null;
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sz = /^LUT_3D_SIZE\s+(\d+)$/i.exec(line);
    if (sz) {
      size = Number(sz[1]);
      if (!Number.isInteger(size) || size < 2 || size > MAX_LUT_SIZE)
        throw new Error('unsupported LUT_3D_SIZE');
      volume = new Uint8Array(size * size * size * 4);
      continue;
    }
    if (!/^[-\d.]/.test(line)) continue; // TITLE, DOMAIN_MIN/MAX, LUT_1D_*
    if (!volume) throw new Error('LUT_3D_SIZE missing');
    const parts = line.split(/\s+/);
    if (parts.length !== 3) continue;
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
    const o = count * 4;
    if (o + 3 >= volume.length) throw new Error('too many entries');
    volume[o] = toByte(r);
    volume[o + 1] = toByte(g);
    volume[o + 2] = toByte(b);
    volume[o + 3] = 255;
    count++;
  }
  if (!volume || !size) throw new Error('LUT_3D_SIZE missing');
  if (count !== size * size * size) throw new Error('truncated LUT: entry count mismatch');
  return { size, volume, source: readSource(text) };
}

export interface LutTiles {
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** RGBA8 of the atlas (`width × height`). */
  data: Uint8Array;
}

/** Atlas layout: as square as possible, blue slice per tile. */
export function tileLayout(size: number): { cols: number; rows: number; width: number; height: number } {
  const cols = Math.ceil(Math.sqrt(size));
  const rows = Math.ceil(size / cols);
  return { cols, rows, width: cols * size, height: rows * size };
}

/** Unfolds the volume into a 2D atlas (WebGL1 fallback). */
export function toTiles(lut: CubeLut): LutTiles {
  const { cols, rows, width, height } = tileLayout(lut.size);
  const data = new Uint8Array(width * height * 4);
  const n = lut.size;
  for (let b = 0; b < n; b++) {
    const ox = (b % cols) * n;
    const oy = Math.floor(b / cols) * n;
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const src = ((b * n + g) * n + r) * 4;
        const dst = ((oy + g) * width + ox + r) * 4;
        data[dst] = lut.volume[src]!;
        data[dst + 1] = lut.volume[src + 1]!;
        data[dst + 2] = lut.volume[src + 2]!;
        data[dst + 3] = 255;
      }
  }
  return { cols, rows, width, height, data };
}

/**
 * CPU trilinear sampling — serves as the reference for the tests (the GPU does the same
 * computation in hardware) and as a check of a freshly read LUT.
 */
export function sampleLut(lut: CubeLut, rgb: [number, number, number]): [number, number, number] {
  const n = lut.size;
  const pos = rgb.map((v) => Math.min(Math.max(v, 0), 1) * (n - 1));
  const i0 = pos.map((p) => Math.floor(p));
  const f = pos.map((p, k) => p - i0[k]);
  const at = (r: number, g: number, b: number, c: number) => {
    const cl = (v: number) => Math.min(Math.max(v, 0), n - 1);
    return lut.volume[((cl(b) * n + cl(g)) * n + cl(r)) * 4 + c] / 255;
  };
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let acc = 0;
    for (let k = 0; k < 8; k++) {
      const dr = k & 1;
      const dg = (k >> 1) & 1;
      const db = (k >> 2) & 1;
      const w = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2]);
      if (w > 0) acc += w * at(i0[0] + dr, i0[1] + dg, i0[2] + db, c);
    }
    out[c] = acc;
  }
  return out;
}
