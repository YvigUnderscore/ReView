// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lecture d'une LUT 3D `.cube` cuite par le backend (`lib/ocioBake.ts` ou `bake_lut.py`) et
 * mise en forme pour le GPU. Module **pur** — aucun appel WebGL, aucun réseau.
 *
 * Deux emballages, parce que deux générations de contexte :
 *  - `volume` : RGBA8 dans l'ordre attendu par `texImage3D` (WebGL2), rouge variant le plus vite ;
 *  - `tiles`  : la même grille dépliée en **atlas 2D** (une tranche bleue par tuile), repli
 *    WebGL1 où `sampler3D` n'existe pas.
 *
 * Les valeurs d'une LUT d'affichage sont des codes écran dans [0,1] : les stocker en 8 bits
 * n'ajoute pas d'erreur visible devant une source 8 bits et une sortie 8 bits, et évite de
 * dépendre du filtrage des textures flottantes.
 */

/** Provenance de la LUT, lue dans l'en-tête du fichier — affichée telle quelle au superviseur. */
export type LutSource = 'ocio' | 'builtin' | 'unknown';

export interface CubeLut {
  size: number;
  /** RGBA8, `size³` texels, rouge le plus rapide. */
  volume: Uint8Array;
  source: LutSource;
}

/** Taille maximale acceptée (65³ ≈ 275 000 entrées) — au-delà, le fichier est refusé. */
export const MAX_LUT_SIZE = 65;

const SOURCE_RE = /^#\s*ReView display transform\s*\|\s*source:\s*(.+)$/i;

/** Déduit la provenance d'après la ligne d'en-tête écrite par le backend. */
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
 * Parse un `.cube` 3D. Lève sur un fichier tronqué : mieux vaut afficher « transformée
 * indisponible » que d'échantillonner une grille incomplète.
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
  /** RGBA8 de l'atlas (`width × height`). */
  data: Uint8Array;
}

/** Disposition de l'atlas : le plus carré possible, tranche bleue par tuile. */
export function tileLayout(size: number): { cols: number; rows: number; width: number; height: number } {
  const cols = Math.ceil(Math.sqrt(size));
  const rows = Math.ceil(size / cols);
  return { cols, rows, width: cols * size, height: rows * size };
}

/** Déplie le volume en atlas 2D (repli WebGL1). */
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
 * Échantillonnage trilinéaire sur CPU — sert de référence aux tests (le GPU fait le même
 * calcul en matériel) et de vérification d'une LUT fraîchement lue.
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
