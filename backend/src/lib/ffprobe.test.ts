// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parseFrameRate, parseFrameRateFraction, parseProbeOutput, probeArgs } from './ffprobe';

const sample = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: { duration: '12.3456' },
    streams: [
      { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '24000/1001' },
      { codec_type: 'audio' },
    ],
    ...over,
  });

describe('parseFrameRate', () => {
  it('rationnel ffprobe arrondi au centième (valeur historique de metadata.fps)', () => {
    expect(parseFrameRate('24000/1001')).toBe(23.98);
    expect(parseFrameRate('25/1')).toBe(25);
    expect(parseFrameRate('30000/1001')).toBe(29.97);
  });

  it('valeurs inexploitables : undefined', () => {
    expect(parseFrameRate('0/0')).toBeUndefined();
    expect(parseFrameRate('25')).toBeUndefined();
    expect(parseFrameRate(undefined)).toBeUndefined();
    expect(parseFrameRate(25)).toBeUndefined();
    expect(parseFrameRate('a/b')).toBeUndefined();
  });
});

describe('parseFrameRateFraction', () => {
  it('garde la cadence exacte plutôt que son arrondi', () => {
    expect(parseFrameRateFraction('24000/1001')).toEqual({ num: 24000, den: 1001 });
    expect(parseFrameRateFraction('30000/1001')).toEqual({ num: 30000, den: 1001 });
    // L'arrondi historique, lui, perd 0,004 frame par seconde.
    expect(parseFrameRate('24000/1001')).toBe(23.98);
    expect(24000 / 1001).not.toBe(23.98);
  });

  it('réduit la fraction : 50/2 et 25/1 décrivent la même cadence', () => {
    expect(parseFrameRateFraction('50/2')).toEqual({ num: 25, den: 1 });
    expect(parseFrameRateFraction('25/1')).toEqual({ num: 25, den: 1 });
  });

  it('laisse intacte une fraction non entière (rien à réduire)', () => {
    expect(parseFrameRateFraction('29.97/1')).toEqual({ num: 29.97, den: 1 });
  });

  it('rejette ce qui n’est pas une cadence', () => {
    expect(parseFrameRateFraction('0/0')).toBeUndefined();
    expect(parseFrameRateFraction('25')).toBeUndefined();
    expect(parseFrameRateFraction('a/b')).toBeUndefined();
    expect(parseFrameRateFraction(undefined)).toBeUndefined();
    expect(parseFrameRateFraction(25)).toBeUndefined();
  });
});

describe('parseProbeOutput', () => {
  it('extrait durée, dimensions, cadence et présence d’audio', () => {
    expect(parseProbeOutput(sample())).toEqual({
      duration: 12.35,
      width: 1920,
      height: 1080,
      fps: 23.98,
      // La cadence exacte accompagne désormais l'arrondi historique.
      fpsNum: 24000,
      fpsDen: 1001,
      hasAudio: true,
    });
  });

  it('les nombres arrivent en chaînes dans le JSON brut', () => {
    const raw = JSON.stringify({
      format: { duration: '3' },
      streams: [{ codec_type: 'video', width: '640', height: '480' }],
    });
    expect(parseProbeOutput(raw)).toMatchObject({ duration: 3, width: 640, height: 480 });
  });

  it('média sans piste audio', () => {
    const raw = JSON.stringify({
      format: { duration: '5' },
      streams: [{ codec_type: 'video', width: 10, height: 10 }],
    });
    expect(parseProbeOutput(raw).hasAudio).toBe(false);
  });

  it('image fixe : pas de durée', () => {
    const raw = JSON.stringify({
      format: {},
      streams: [{ codec_type: 'video', width: 800, height: 600 }],
    });
    const p = parseProbeOutput(raw);
    expect(p.duration).toBeUndefined();
    expect(p.width).toBe(800);
  });

  it('sortie illisible ou vide : résultat vide, jamais d’exception', () => {
    expect(parseProbeOutput('')).toEqual({});
    expect(parseProbeOutput('not json')).toEqual({});
    expect(parseProbeOutput('{}')).toEqual({
      duration: undefined,
      width: undefined,
      height: undefined,
      fps: undefined,
      hasAudio: false,
    });
  });

  it('durée « N/A » : ignorée plutôt que NaN', () => {
    const raw = JSON.stringify({ format: { duration: 'N/A' }, streams: [] });
    expect(parseProbeOutput(raw).duration).toBeUndefined();
  });
});

describe('probeArgs', () => {
  it('demande le JSON complet du fichier visé', () => {
    const args = probeArgs('/tmp/a b.mp4');
    expect(args).toContain('-print_format');
    expect(args).toContain('json');
    expect(args).toContain('-show_streams');
    // Le chemin est un argument distinct : jamais de shell, donc pas d'échappement à faire.
    expect(args[args.length - 1]).toBe('/tmp/a b.mp4');
  });
});
