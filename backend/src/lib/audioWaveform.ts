// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

/**
 * Compact audio waveform, computed at transcode time.
 *
 * The player showed nothing of the sound: the probe recorded `hasAudio` and nobody read it.
 * Spotting a lip-sync offset or a cut-off line meant listening to the whole video. So we produce,
 * once and for all, **one peak per bar** (one byte) rather than an image: a few hundred bytes
 * travel with the media metadata, with no derived file to store and no presigned URL to regenerate.
 *
 * The analysed stream is mono `s16le` PCM extracted by ffmpeg (see `ffmpeg.worker`), read as a
 * stream: a feature film does not fit in memory at 8 kHz, the accumulator does.
 */

/** Sample rate of the extracted mono PCM stream used for analysis. */
export const WAVEFORM_SAMPLE_RATE = 8000;

/** Target waveform resolution: eight bars per second, clamped to extremes. */
const BINS_PER_SEC = 8;
const MIN_BINS = 64;
const MAX_BINS = 1200;

/** Waveform stored in `metadata.waveform` of a video MediaObject. */
export interface WaveformMeta {
  version: 1;
  /** Number of bars: bar `i` covers `[i/bins, (i+1)/bins]` of the duration. */
  bins: number;
  /** Peaks 0..255, one byte per bar, base64-encoded. */
  peaks: string;
}

/**
 * Number of bars for a given duration. `null` when the duration is unknown or zero: without it no
 * bar maps to an instant, and the waveform would be misleading.
 */
export function planWaveformBins(durationSec: number | undefined): number | null {
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  return Math.min(MAX_BINS, Math.max(MIN_BINS, Math.round(durationSec * BINS_PER_SEC)));
}

const toSigned = (v: number): number => (v >= 0x8000 ? v - 0x10000 : v);

/**
 * Peak accumulator over a mono `s16le` PCM stream.
 *
 * Read chunks have no reason to contain an even number of bytes: the orphan low byte is kept
 * (`carry`) and joined to the next chunk, otherwise a single odd chunk would shift the rest of the
 * track by one byte, producing noise.
 */
export class PeakAccumulator {
  private readonly peaks: Uint8Array;
  private readonly totalSamples: number;
  private index = 0;
  private carry: number | null = null;

  constructor(totalSamples: number, bins: number) {
    this.totalSamples = Math.max(1, Math.floor(totalSamples));
    this.peaks = new Uint8Array(Math.max(1, Math.floor(bins)));
  }

  private addSample(value: number): void {
    const bin = Math.min(
      this.peaks.length - 1,
      Math.floor((this.index * this.peaks.length) / this.totalSamples),
    );
    const amp = Math.min(255, Math.round((Math.abs(value) / 32768) * 255));
    if (amp > (this.peaks[bin] ?? 0)) this.peaks[bin] = amp;
    this.index += 1;
  }

  push(chunk: Buffer): void {
    let i = 0;
    if (this.carry !== null && chunk.length > 0) {
      this.addSample(toSigned(((chunk.readUInt8(0) << 8) | this.carry) & 0xffff));
      this.carry = null;
      i = 1;
    }
    for (; i + 1 < chunk.length; i += 2) this.addSample(chunk.readInt16LE(i));
    if (i < chunk.length) this.carry = chunk.readUInt8(i);
  }

  finish(): Uint8Array {
    return this.peaks;
  }
}

/** Encodes the peaks in base64: one byte per bar. */
export function encodePeaks(peaks: Uint8Array): WaveformMeta {
  return { version: 1, bins: peaks.length, peaks: Buffer.from(peaks).toString('base64') };
}

/**
 * Reads a mono `s16le` PCM file and derives the waveform from it. The exact sample count comes from
 * the file size, not the probed duration: an approximate duration would gradually shift the bars
 * relative to the picture.
 */
export async function waveformFromPcmFile(path: string, bins: number): Promise<WaveformMeta | null> {
  const { size } = await stat(path);
  const totalSamples = Math.floor(size / 2);
  if (totalSamples <= 0) return null;
  const acc = new PeakAccumulator(totalSamples, bins);
  for await (const chunk of createReadStream(path)) acc.push(chunk as Buffer);
  return encodePeaks(acc.finish());
}
