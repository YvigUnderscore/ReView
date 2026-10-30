// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { ffmpegFraction, mediaJobProgress, parseTimemarkSec, type MediaJobStep } from './mediaProgress';

describe('mediaJobProgress', () => {
  it('start of a step — lower bound of the range', () => {
    expect(mediaJobProgress('transcode', 'download')).toEqual({ step: 'download', percent: 0 });
    expect(mediaJobProgress('transcode', 'proxy')).toEqual({ step: 'proxy', percent: 10 });
    expect(mediaJobProgress('transcode', 'renditions')).toEqual({ step: 'renditions', percent: 36 });
  });

  it('fin de travail : 100 %', () => {
    expect(mediaJobProgress('transcode', 'done').percent).toBe(100);
    expect(mediaJobProgress('convert3d', 'done').percent).toBe(100);
  });

  it('interpolates with the ffmpeg progress within a step', () => {
    expect(mediaJobProgress('transcode', 'proxy', { fraction: 0.5 }).percent).toBe(21);
    expect(mediaJobProgress('transcode', 'proxy', { fraction: 1 }).percent).toBe(32);
  });

  it('renditions — the range is shared between the rungs, 1-based index published', () => {
    expect(mediaJobProgress('transcode', 'renditions', { index: 0, total: 3 })).toEqual({
      step: 'renditions',
      percent: 36,
      index: 1,
      total: 3,
    });
    expect(mediaJobProgress('transcode', 'renditions', { index: 1, total: 3 }).percent).toBe(52);
    expect(mediaJobProgress('transcode', 'renditions', { index: 2, total: 3, fraction: 1 }).percent).toBe(84);
  });

  it('the progress of a transcode is monotonic in the order of the steps', () => {
    const order: MediaJobStep[] = [
      'download',
      'probe',
      'proxy',
      'thumbnail',
      'renditions',
      'client',
      'scenes',
      'sprite',
      'done',
    ];
    const values = order.map((s) => mediaJobProgress('transcode', s).percent);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThan(values[i - 1]!);
  });

  it('bounds aberrant inputs rather than leaving 0-100', () => {
    expect(mediaJobProgress('transcode', 'proxy', { fraction: 5 }).percent).toBe(32);
    expect(mediaJobProgress('transcode', 'proxy', { fraction: -3 }).percent).toBe(10);
    expect(mediaJobProgress('transcode', 'proxy', { fraction: Number.NaN }).percent).toBe(10);
    expect(mediaJobProgress('transcode', 'renditions', { index: 9, total: 2 }).percent).toBe(60);
    expect(mediaJobProgress('transcode', 'renditions', { index: -4, total: 2 }).percent).toBe(36);
  });

  it('a step foreign to the type of work: 0, never an exception', () => {
    expect(mediaJobProgress('thumbnail', 'renditions')).toEqual({ step: 'renditions', percent: 0 });
    expect(mediaJobProgress('scan', 'proxy').percent).toBe(0);
  });

  it('each type of work stays within 0-100', () => {
    const kinds = ['transcode', 'thumbnail', 'convert3d', 'scan'] as const;
    const steps: MediaJobStep[] = [
      'download',
      'probe',
      'proxy',
      'thumbnail',
      'renditions',
      'client',
      'scenes',
      'sprite',
      'convert',
      'scan',
      'done',
    ];
    for (const kind of kinds)
      for (const step of steps) {
        const p = mediaJobProgress(kind, step, { fraction: 1 }).percent;
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(100);
      }
  });
});

describe('parseTimemarkSec', () => {
  it('reads the ffmpeg timemark', () => {
    expect(parseTimemarkSec('00:00:00.00')).toBe(0);
    expect(parseTimemarkSec('00:01:23.45')).toBeCloseTo(83.45, 5);
    expect(parseTimemarkSec('01:00:00.00')).toBe(3600);
    expect(parseTimemarkSec(' 00:00:12 ')).toBe(12);
  });

  it('valeurs inexploitables : null', () => {
    expect(parseTimemarkSec(undefined)).toBeNull();
    expect(parseTimemarkSec('N/A')).toBeNull();
    expect(parseTimemarkSec('-00:00:01.00')).toBeNull();
    expect(parseTimemarkSec(12)).toBeNull();
  });
});

describe('ffmpegFraction', () => {
  it('uses percent when ffmpeg knows it', () => {
    expect(ffmpegFraction({ percent: 42 })).toBeCloseTo(0.42, 5);
    expect(ffmpegFraction({ percent: 0 })).toBe(0);
  });

  it('bounds an aberrant percent (ffmpeg sometimes exceeds 100)', () => {
    expect(ffmpegFraction({ percent: 130 })).toBe(1);
    expect(ffmpegFraction({ percent: -5 })).toBe(0);
  });

  it('falls back on the timemark relative to the probed duration', () => {
    expect(ffmpegFraction({ timemark: '00:00:30.00' }, 60)).toBeCloseTo(0.5, 5);
    expect(ffmpegFraction({ percent: null, timemark: '00:01:00.00' }, 60)).toBe(1);
  });

  it('without percent or duration: null, the caller invents nothing', () => {
    expect(ffmpegFraction({ timemark: '00:00:30.00' })).toBeNull();
    expect(ffmpegFraction({ timemark: '00:00:30.00' }, 0)).toBeNull();
    expect(ffmpegFraction({})).toBeNull();
  });
});
