// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Forme d'onde audio du média, telle que le worker la range dans ses métadonnées :
 * une crête par barre, un octet, encodée en base64 (cf. `backend/src/lib/audioWaveform`).
 * Le lecteur n'analyse donc rien à l'ouverture — il déplie quelques centaines d'octets.
 */
export interface WaveformMeta {
  version?: number;
  bins: number;
  /** Crêtes 0..255 en base64, une par barre. */
  peaks: string;
}

/** Déplie les crêtes ; `null` si la forme d'onde est absente ou illisible. */
export function decodeWaveformPeaks(meta: WaveformMeta | null | undefined): Uint8Array | null {
  if (!meta || typeof meta.peaks !== 'string' || meta.peaks.length === 0) return null;
  try {
    const binary = atob(meta.peaks);
    if (binary.length === 0) return null;
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    // Métadonnée corrompue : pas de forme d'onde, le lecteur reste utilisable.
    return null;
  }
}

/**
 * Rééchantillonne les crêtes pour l'affichage, en hauteurs 0..1.
 *
 * Moins de barres que de crêtes : on garde le **maximum** de l'intervalle, jamais la
 * moyenne — un transitoire d'une frame (claquette, coupure de dialogue) est précisément
 * ce que l'on cherche à voir, et une moyenne l'efface. Plus de barres que de crêtes :
 * on répète la crête la plus proche plutôt que de laisser des trous.
 */
export function waveformBars(peaks: Uint8Array, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  if (peaks.length === 0) return new Array<number>(n).fill(0);
  if (n >= peaks.length) {
    return Array.from({ length: n }, (_, i) => peaks[Math.floor((i * peaks.length) / n)] / 255);
  }
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < peaks.length; i++) {
    const bar = Math.min(n - 1, Math.floor((i * n) / peaks.length));
    const v = peaks[i] / 255;
    if (v > out[bar]) out[bar] = v;
  }
  return out;
}
