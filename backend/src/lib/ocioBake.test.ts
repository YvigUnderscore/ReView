// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  bakeBuiltinLut,
  decode,
  displaySpace,
  encode,
  isBuiltinBakeable,
  LUT_SIZE,
  lutStorageKey,
  parseCube,
  PRIMARIES,
  primariesMatrix,
  rgbToXyz,
  serializeCube,
  SRGB_TEXTURE,
  viewKind,
} from './ocioBake';

const near = (a: number, b: number, eps = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('ocioBake — colorimétrie', () => {
  it('rgbToXyz(sRGB) reproduit la matrice publiée de Rec.709/D65', () => {
    const m = rgbToXyz(PRIMARIES.sRGB);
    const expected = [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505];
    expected.forEach((v, i) => near(m[i]!, v, 5e-4));
  });

  it('primariesMatrix(x, x) est l’identité et sRGB→P3 rétrécit le rouge', () => {
    const id = primariesMatrix(PRIMARIES.sRGB, PRIMARIES.sRGB);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => near(id[i]!, v, 1e-6));
    // Le P3 est plus large : un rouge sRGB saturé y occupe moins que le primaire.
    const toP3 = primariesMatrix(PRIMARIES.sRGB, PRIMARIES.p3d65);
    expect(toP3[0]!).toBeLessThan(1);
    expect(toP3[3]!).toBeGreaterThan(0);
  });

  it('les fonctions de transfert sont inversibles et ACEScct place 0.18 à ~0.4136', () => {
    for (const v of [0, 0.01, 0.18, 0.5, 1]) {
      near(decode({ kind: 'srgb' }, encode({ kind: 'srgb' }, v)), v, 1e-6);
      near(decode({ kind: 'gamma', g: 2.4 }, encode({ kind: 'gamma', g: 2.4 }, v)), v, 1e-6);
      near(decode({ kind: 'acescct' }, encode({ kind: 'acescct' }, v)), v, 1e-5);
    }
    near(encode({ kind: 'acescct' }, 0.18), 0.4135884, 1e-6);
    near(encode({ kind: 'srgb' }, 0.18), 0.4613561, 1e-6);
  });
});

describe('ocioBake — reconnaissance des displays/views', () => {
  it('reconnaît les displays SDR des configs ACES, refuse les HDR', () => {
    expect(displaySpace('sRGB - Display')).not.toBeNull();
    expect(displaySpace('Display P3 - Display')?.primaries).toEqual(PRIMARIES.p3d65);
    expect(displaySpace('Rec.1886 Rec.709 - Display')?.transfer).toEqual({ kind: 'gamma', g: 2.4 });
    expect(displaySpace('Rec.2100-PQ - Display')).toBeNull();
    expect(displaySpace('ST2084-P3-D65 - Display')).toBeNull();
  });

  it('classe les vues ; toute vue à courbe de rendu reste hors du repli intégré', () => {
    expect(viewKind('Raw')).toBe('raw');
    expect(viewKind('Un-tone-mapped')).toBe('colorimetric');
    expect(viewKind('Log')).toBe('log');
    expect(viewKind('ACES 1.0 - SDR Video')).toBe('tonemapped');
    expect(viewKind('ACES 2.0 - SDR 100 nits (Rec.709)')).toBe('tonemapped');
    expect(isBuiltinBakeable('sRGB - Display', 'ACES 1.0 - SDR Video')).toBe(false);
    expect(isBuiltinBakeable('sRGB - Display', 'Un-tone-mapped')).toBe(true);
    expect(isBuiltinBakeable('Rec.2100-PQ - Display', 'Un-tone-mapped')).toBe(false);
    expect(isBuiltinBakeable('Rec.2100-PQ - Display', 'Raw')).toBe(true);
  });
});

describe('ocioBake — cuisson intégrée', () => {
  it('refuse une vue tone-mappée plutôt que de l’approcher', () => {
    expect(bakeBuiltinLut('sRGB - Display', 'ACES 1.0 - SDR Video')).toBeNull();
  });

  it('Raw produit l’identité (les codes traversent sans modification)', () => {
    const lut = bakeBuiltinLut('sRGB - Display', 'Raw', SRGB_TEXTURE, 5)!;
    expect(lut.size).toBe(5);
    // Index (r=4, g=0, b=2) → rouge le plus rapide.
    const i = (4 + 0 * 5 + 2 * 25) * 3;
    near(lut.data[i]!, 1);
    near(lut.data[i + 1]!, 0);
    near(lut.data[i + 2]!, 0.5);
  });

  it('sRGB texture → display sRGB non tone-mappé est un aller-retour neutre', () => {
    const lut = bakeBuiltinLut('sRGB - Display', 'Un-tone-mapped', SRGB_TEXTURE, 9)!;
    for (let k = 0; k < lut.data.length; k += 3) {
      const idx = k / 3;
      const r = (idx % 9) / 8;
      near(lut.data[k]!, r, 1e-5);
    }
  });

  it('sRGB texture → Rec.1886 relève le code des tons moyens (gamma 2.4 pur)', () => {
    const lut = bakeBuiltinLut('Rec.1886 Rec.709 - Display', 'Un-tone-mapped', SRGB_TEXTURE, 3)!;
    const mid = (1 + 1 * 3 + 1 * 9) * 3; // gris 0.5 encodé sRGB
    // Le gamma 2.4 pur assombrit davantage que la courbe sRGB : pour restituer la même
    // lumière, le code d'affichage doit monter.
    expect(lut.data[mid]!).toBeGreaterThan(0.5);
    near(lut.data[mid]!, Math.pow(decode({ kind: 'srgb' }, 0.5), 1 / 2.4), 1e-5);
  });

  it('la vue Log encode en ACEScct dans AP1', () => {
    const lut = bakeBuiltinLut('sRGB - Display', 'Log', SRGB_TEXTURE, 3)!;
    const black = 0;
    near(lut.data[black]!, encode({ kind: 'acescct' }, 0), 1e-5);
    const white = (2 + 2 * 3 + 2 * 9) * 3;
    expect(lut.data[white]!).toBeGreaterThan(0.5);
  });
});

describe('ocioBake — format .cube', () => {
  it('sérialise puis relit une LUT à l’identique', () => {
    const lut = bakeBuiltinLut('Display P3 - Display', 'Un-tone-mapped', SRGB_TEXTURE, 7)!;
    const text = serializeCube(lut, 'Display P3 - Display / Un-tone-mapped');
    expect(text).toContain('LUT_3D_SIZE 7');
    const back = parseCube(text);
    expect(back.size).toBe(7);
    expect(back.data.length).toBe(7 * 7 * 7 * 3);
    for (let i = 0; i < back.data.length; i += 97) near(back.data[i]!, lut.data[i]!, 1e-5);
  });

  it('rejette un .cube tronqué ou sans taille', () => {
    expect(() => parseCube('0.0 0.0 0.0\n')).toThrow(/LUT_3D_SIZE missing/);
    expect(() => parseCube('LUT_3D_SIZE 3\n0.0 0.0 0.0\n')).toThrow(/expected/);
    expect(() => parseCube('LUT_3D_SIZE 1024\n')).toThrow(/unsupported/);
  });

  it('la taille par défaut est 33³ et la clé de stockage est stable et cloisonnée', () => {
    expect(LUT_SIZE).toBe(33);
    const a = lutStorageKey('cfg-1', 'sRGB - Display', 'ACES 1.0 - SDR Video');
    expect(a).toBe(lutStorageKey('cfg-1', 'sRGB - Display', 'ACES 1.0 - SDR Video'));
    expect(a).toMatch(/^studio\/ocio\/luts\/cfg-1\/srgb-display__aces-1-0-sdr-video__[0-9a-f]{8}\.cube$/);
    expect(a).not.toBe(lutStorageKey('cfg-2', 'sRGB - Display', 'ACES 1.0 - SDR Video'));
    // Deux vues dont le slug se confond restent séparées par le condensé.
    expect(lutStorageKey('c', 'D', 'ACES 1.0')).not.toBe(lutStorageKey('c', 'D', 'ACES/1.0'));
  });
});
