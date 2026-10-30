// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Audio waveform of the media, as the worker stores it in its metadata: one peak per bar, one
 * byte, base64-encoded (see `backend/src/lib/audioWaveform`). The player therefore analyzes
 * nothing on open — it unfolds a few hundred bytes.
 */
export interface WaveformMeta {
  version?: number;
  bins: number;
  /** Peaks 0..255 in base64, one per bar. */
  peaks: string;
}

/** Unfolds the peaks; `null` if the waveform is absent or unreadable. */
export function decodeWaveformPeaks(meta: WaveformMeta | null | undefined): Uint8Array | null {
  if (!meta || typeof meta.peaks !== 'string' || meta.peaks.length === 0) return null;
  try {
    const binary = atob(meta.peaks);
    if (binary.length === 0) return null;
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    // Corrupted metadata: no waveform, the player stays usable.
    return null;
  }
}

/**
 * Resamples the peaks for display, as heights 0..1.
 *
 * Fewer bars than peaks: we keep the **maximum** of the interval, never the average — a
 * one-frame transient (clapperboard, dialogue cut) is exactly what we want to see, and an
 * average would erase it. More bars than peaks: we repeat the nearest peak rather than leave
 * gaps.
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
