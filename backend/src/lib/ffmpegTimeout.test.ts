// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  FFMPEG_MAX_TIMEOUT_MS,
  FFMPEG_MIN_TIMEOUT_MS,
  FFMPEG_UNKNOWN_TIMEOUT_MS,
  FfmpegTimeoutError,
  ffmpegTimeoutMessage,
  ffmpegTimeoutMs,
  isFfmpegTimeout,
} from './ffmpegTimeout';

describe('ffmpegTimeoutMs', () => {
  it('unknown duration: flat rate', () => {
    expect(ffmpegTimeoutMs()).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(null)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(0)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(-12)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(Number.NaN)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(Number.POSITIVE_INFINITY)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
  });

  it('short media: the floor protects tiny files', () => {
    // 5 s × 20 = 100 s, below the 5-minute floor.
    expect(ffmpegTimeoutMs(5)).toBe(FFMPEG_MIN_TIMEOUT_MS);
  });

  it('medium media: proportional to the duration', () => {
    // 10 min × 20 = 200 min, between floor and ceiling.
    expect(ffmpegTimeoutMs(600)).toBe(600 * 1000 * 20);
  });

  it('very long media: the ceiling bounds the wait', () => {
    expect(ffmpegTimeoutMs(10 * 3600)).toBe(FFMPEG_MAX_TIMEOUT_MS);
  });

  it('the window is monotonic in the duration', () => {
    const values = [1, 10, 60, 600, 3600, 36_000].map((d) => ffmpegTimeoutMs(d));
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  });

  it('options: custom factor and bounds', () => {
    expect(ffmpegTimeoutMs(30, { factor: 2, minMs: 1000, maxMs: 1_000_000 })).toBe(60_000);
    expect(ffmpegTimeoutMs(30, { factor: 2, minMs: 90_000, maxMs: 1_000_000 })).toBe(90_000);
    expect(ffmpegTimeoutMs(30, { factor: 2, minMs: 1000, maxMs: 10_000 })).toBe(10_000);
    expect(ffmpegTimeoutMs(undefined, { unknownMs: 1234 })).toBe(1234);
  });

  it('the result is always an integer number of milliseconds', () => {
    expect(Number.isInteger(ffmpegTimeoutMs(12.345))).toBe(true);
  });
});

describe('ffmpegTimeoutMessage', () => {
  it('names the step and the limit, in English', () => {
    expect(ffmpegTimeoutMessage('proxy', 300_000)).toBe(
      'ffmpeg step "proxy" exceeded its 300s time limit and was killed',
    );
  });
});

describe('FfmpegTimeoutError', () => {
  it('carries the usable message and the step', () => {
    const err = new FfmpegTimeoutError('hls 720p', 600_000);
    expect(err.message).toContain('hls 720p');
    expect(err.message).toContain('600s');
    expect(err.label).toBe('hls 720p');
    expect(err.timeoutMs).toBe(600_000);
    expect(err).toBeInstanceOf(Error);
  });

  it('is distinct from an ordinary encoding failure (no libx264 fallback)', () => {
    expect(isFfmpegTimeout(new FfmpegTimeoutError('proxy', 1000))).toBe(true);
    expect(isFfmpegTimeout(new Error('Unknown encoder h264_nvenc'))).toBe(false);
    expect(isFfmpegTimeout('boom')).toBe(false);
    expect(isFfmpegTimeout(null)).toBe(false);
  });
});
