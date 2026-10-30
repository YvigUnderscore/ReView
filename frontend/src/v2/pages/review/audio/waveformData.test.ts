// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { decodeWaveformPeaks, waveformBars } from './waveformData';

const encode = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

describe('decodeWaveformPeaks', () => {
  it('unfolds the base64 peaks', () => {
    const peaks = decodeWaveformPeaks({ bins: 3, peaks: encode([0, 128, 255]) });
    expect([...peaks!]).toEqual([0, 128, 255]);
  });

  it('absent, empty or corrupted: nothing to display', () => {
    expect(decodeWaveformPeaks(null)).toBeNull();
    expect(decodeWaveformPeaks(undefined)).toBeNull();
    expect(decodeWaveformPeaks({ bins: 0, peaks: '' })).toBeNull();
    expect(decodeWaveformPeaks({ bins: 2, peaks: '!!not base64!!' })).toBeNull();
  });
});

describe('waveformBars', () => {
  it('reduces by keeping the peak, never the average', () => {
    // An isolated transient in the middle of silence must survive the reduction.
    const peaks = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 0]);
    expect(waveformBars(peaks, 2)).toEqual([1, 0]);
  });

  it('heights normalized to 0..1', () => {
    expect(waveformBars(Uint8Array.from([255, 0]), 2)).toEqual([1, 0]);
  });

  it('more bars than peaks: no gap', () => {
    const bars = waveformBars(Uint8Array.from([255, 128]), 6);
    expect(bars).toHaveLength(6);
    expect(bars.every((v) => v > 0)).toBe(true);
  });

  it('no peak: only silence', () => {
    expect(waveformBars(new Uint8Array(0), 3)).toEqual([0, 0, 0]);
  });
});
