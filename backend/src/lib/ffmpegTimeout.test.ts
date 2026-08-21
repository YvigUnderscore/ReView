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
  it('durée inconnue : forfait', () => {
    expect(ffmpegTimeoutMs()).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(null)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(0)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(-12)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(Number.NaN)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
    expect(ffmpegTimeoutMs(Number.POSITIVE_INFINITY)).toBe(FFMPEG_UNKNOWN_TIMEOUT_MS);
  });

  it('média court : le plancher protège des fichiers minuscules', () => {
    // 5 s × 20 = 100 s, sous le plancher de 5 min.
    expect(ffmpegTimeoutMs(5)).toBe(FFMPEG_MIN_TIMEOUT_MS);
  });

  it('média moyen : proportionnel à la durée', () => {
    // 10 min × 20 = 200 min, entre plancher et plafond.
    expect(ffmpegTimeoutMs(600)).toBe(600 * 1000 * 20);
  });

  it('média très long : le plafond borne l’attente', () => {
    expect(ffmpegTimeoutMs(10 * 3600)).toBe(FFMPEG_MAX_TIMEOUT_MS);
  });

  it('la fenêtre est monotone en la durée', () => {
    const values = [1, 10, 60, 600, 3600, 36_000].map((d) => ffmpegTimeoutMs(d));
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  });

  it('options : facteur et bornes personnalisés', () => {
    expect(ffmpegTimeoutMs(30, { factor: 2, minMs: 1000, maxMs: 1_000_000 })).toBe(60_000);
    expect(ffmpegTimeoutMs(30, { factor: 2, minMs: 90_000, maxMs: 1_000_000 })).toBe(90_000);
    expect(ffmpegTimeoutMs(30, { factor: 2, minMs: 1000, maxMs: 10_000 })).toBe(10_000);
    expect(ffmpegTimeoutMs(undefined, { unknownMs: 1234 })).toBe(1234);
  });

  it('le résultat est toujours un entier de millisecondes', () => {
    expect(Number.isInteger(ffmpegTimeoutMs(12.345))).toBe(true);
  });
});

describe('ffmpegTimeoutMessage', () => {
  it('nomme l’étape et la limite, en anglais', () => {
    expect(ffmpegTimeoutMessage('proxy', 300_000)).toBe(
      'ffmpeg step "proxy" exceeded its 300s time limit and was killed',
    );
  });
});

describe('FfmpegTimeoutError', () => {
  it('porte le message exploitable et l’étape', () => {
    const err = new FfmpegTimeoutError('hls 720p', 600_000);
    expect(err.message).toContain('hls 720p');
    expect(err.message).toContain('600s');
    expect(err.label).toBe('hls 720p');
    expect(err.timeoutMs).toBe(600_000);
    expect(err).toBeInstanceOf(Error);
  });

  it('se distingue d’un échec d’encodage ordinaire (pas de repli libx264)', () => {
    expect(isFfmpegTimeout(new FfmpegTimeoutError('proxy', 1000))).toBe(true);
    expect(isFfmpegTimeout(new Error('Unknown encoder h264_nvenc'))).toBe(false);
    expect(isFfmpegTimeout('boom')).toBe(false);
    expect(isFfmpegTimeout(null)).toBe(false);
  });
});
