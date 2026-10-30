// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodePeaks, PeakAccumulator, planWaveformBins, waveformFromPcmFile } from './audioWaveform';

/** Builds mono s16le PCM from integer amplitudes. */
const pcm = (samples: number[]): Buffer => {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
};

const decode = (b64: string): number[] => [...Buffer.from(b64, 'base64')];

describe('planWaveformBins', () => {
  it('eight bars per second, floor at 64', () => {
    expect(planWaveformBins(60)).toBe(480);
    expect(planWaveformBins(2)).toBe(64);
  });

  it('upper bound of 1200 bars, whatever the duration', () => {
    expect(planWaveformBins(7200)).toBe(1200);
  });

  it('unknown or zero duration: no waveform', () => {
    expect(planWaveformBins(undefined)).toBeNull();
    expect(planWaveformBins(0)).toBeNull();
    expect(planWaveformBins(Number.NaN)).toBeNull();
  });
});

describe('PeakAccumulator', () => {
  it('keeps the peak of each bar, in absolute value', () => {
    const acc = new PeakAccumulator(4, 2);
    acc.push(pcm([1000, 32767, -32768, 0]));
    expect([...acc.finish()]).toEqual([255, 255]);
  });

  it('separates bars: silence then full scale', () => {
    const acc = new PeakAccumulator(4, 2);
    acc.push(pcm([0, 0, 16384, 0]));
    const peaks = [...acc.finish()];
    expect(peaks[0]).toBe(0);
    expect(peaks[1]).toBe(128);
  });

  it('joins an orphan byte between two chunks', () => {
    const whole = pcm([0, 0, 16384, 0]);
    const split = new PeakAccumulator(4, 2);
    split.push(whole.subarray(0, 5));
    split.push(whole.subarray(5));
    expect([...split.finish()]).toEqual([0, 128]);
  });

  it('never overflows the last bin even if the stream exceeds the announced size', () => {
    const acc = new PeakAccumulator(2, 2);
    acc.push(pcm([0, 0, 32767, 32767]));
    expect([...acc.finish()]).toEqual([0, 255]);
  });
});

describe('encodePeaks', () => {
  it('one byte per bar, in base64', () => {
    const meta = encodePeaks(Uint8Array.from([0, 128, 255]));
    expect(meta).toMatchObject({ version: 1, bins: 3 });
    expect(decode(meta.peaks)).toEqual([0, 128, 255]);
  });
});

describe('waveformFromPcmFile', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'review-waveform-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the file as a stream and returns one peak per bar', async () => {
    const path = join(dir, 'audio.pcm');
    await writeFile(path, pcm([0, 0, 0, 0, 32767, 32767, 32767, 32767]));
    const meta = await waveformFromPcmFile(path, 2);
    expect(meta?.bins).toBe(2);
    expect(decode(meta!.peaks)).toEqual([0, 255]);
  });

  it('empty file: no waveform', async () => {
    const path = join(dir, 'empty.pcm');
    await writeFile(path, Buffer.alloc(0));
    expect(await waveformFromPcmFile(path, 8)).toBeNull();
  });
});
