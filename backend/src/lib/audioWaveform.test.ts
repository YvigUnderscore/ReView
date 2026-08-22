// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodePeaks, PeakAccumulator, planWaveformBins, waveformFromPcmFile } from './audioWaveform';

/** Construit un PCM s16le mono à partir d'amplitudes entières. */
const pcm = (samples: number[]): Buffer => {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
};

const decode = (b64: string): number[] => [...Buffer.from(b64, 'base64')];

describe('planWaveformBins', () => {
  it('huit barres par seconde, plancher à 64', () => {
    expect(planWaveformBins(60)).toBe(480);
    expect(planWaveformBins(2)).toBe(64);
  });

  it('borne haute à 1200 barres, quelle que soit la durée', () => {
    expect(planWaveformBins(7200)).toBe(1200);
  });

  it('durée inconnue ou nulle : pas de forme d’onde', () => {
    expect(planWaveformBins(undefined)).toBeNull();
    expect(planWaveformBins(0)).toBeNull();
    expect(planWaveformBins(Number.NaN)).toBeNull();
  });
});

describe('PeakAccumulator', () => {
  it('retient la crête de chaque barre, en valeur absolue', () => {
    const acc = new PeakAccumulator(4, 2);
    acc.push(pcm([1000, 32767, -32768, 0]));
    expect([...acc.finish()]).toEqual([255, 255]);
  });

  it('sépare les barres : silence puis pleine échelle', () => {
    const acc = new PeakAccumulator(4, 2);
    acc.push(pcm([0, 0, 16384, 0]));
    const peaks = [...acc.finish()];
    expect(peaks[0]).toBe(0);
    expect(peaks[1]).toBe(128);
  });

  it('recolle un octet orphelin entre deux morceaux', () => {
    const whole = pcm([0, 0, 16384, 0]);
    const split = new PeakAccumulator(4, 2);
    split.push(whole.subarray(0, 5));
    split.push(whole.subarray(5));
    expect([...split.finish()]).toEqual([0, 128]);
  });

  it('ne déborde jamais du dernier bin même si le flux dépasse la taille annoncée', () => {
    const acc = new PeakAccumulator(2, 2);
    acc.push(pcm([0, 0, 32767, 32767]));
    expect([...acc.finish()]).toEqual([0, 255]);
  });
});

describe('encodePeaks', () => {
  it('un octet par barre, en base64', () => {
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

  it('lit le fichier en flot et rend une crête par barre', async () => {
    const path = join(dir, 'audio.pcm');
    await writeFile(path, pcm([0, 0, 0, 0, 32767, 32767, 32767, 32767]));
    const meta = await waveformFromPcmFile(path, 2);
    expect(meta?.bins).toBe(2);
    expect(decode(meta!.peaks)).toEqual([0, 255]);
  });

  it('fichier vide : pas de forme d’onde', async () => {
    const path = join(dir, 'empty.pcm');
    await writeFile(path, Buffer.alloc(0));
    expect(await waveformFromPcmFile(path, 8)).toBeNull();
  });
});
