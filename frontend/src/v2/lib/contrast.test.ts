// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  AA_CONTRAST,
  contrastRatio,
  hexToRgb,
  hslToRgb,
  mix,
  readableLightness,
  relativeLuminance,
  rgbToHsl,
  statusSwatch,
  type Rgb,
} from './contrast';

const WHITE: Rgb = [1, 1, 1];
const BLACK: Rgb = [0, 0, 0];

describe('conversions', () => {
  it('reads both hex forms, with or without the hash', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb('000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#F00')).toEqual([1, 0, 0]);
  });

  it('rejects anything that is not a colour', () => {
    expect(hexToRgb('')).toBeNull();
    expect(hexToRgb('rouge')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });

  it('round-trips RGB ↔ HSL', () => {
    const [h, s, l] = rgbToHsl([1, 0, 0]);
    expect(Math.round(h)).toBe(0);
    expect(Math.round(s)).toBe(100);
    expect(Math.round(l)).toBe(50);
    const back = hslToRgb(h, s, l);
    expect(back.map((v) => Math.round(v * 255))).toEqual([255, 0, 0]);
  });

  it('returns grey with no hue or saturation', () => {
    expect(rgbToHsl([0.5, 0.5, 0.5])).toEqual([0, 0, 50]);
  });
});

describe('contrastRatio', () => {
  it('gives 21 for black on white and 1 for a colour against itself', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const a = hslToRgb(200, 80, 40);
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10);
  });

  it('ranks white as the lightest', () => {
    expect(relativeLuminance(WHITE)).toBeGreaterThan(relativeLuminance(BLACK));
  });
});

describe('mix', () => {
  it('interpolates between foreground and background', () => {
    expect(mix(WHITE, BLACK, 0.5)).toEqual([0.5, 0.5, 0.5]);
    expect(mix(WHITE, BLACK, 0)).toEqual(BLACK);
    expect(mix(WHITE, BLACK, 1)).toEqual(WHITE);
  });
});

describe('readableLightness', () => {
  it('lightens on a dark background and darkens on a light one', () => {
    const onDark = readableLightness(220, 80, 30, hslToRgb(223, 28, 10), true);
    expect(onDark).toBeGreaterThan(30);
    const onLight = readableLightness(50, 90, 80, hslToRgb(220, 25, 97), false);
    expect(onLight).toBeLessThan(80);
  });

  it('does not move a colour that is already readable', () => {
    const bg = hslToRgb(223, 28, 10);
    const already = readableLightness(184, 100, 50, bg, true);
    expect(already).toBe(50);
  });
});

describe('statusSwatch', () => {
  it('returns null without a usable colour', () => {
    expect(statusSwatch(null, true)).toBeNull();
    expect(statusSwatch(undefined, false)).toBeNull();
    expect(statusSwatch('pas-une-couleur', true)).toBeNull();
  });

  // The two cases cited by the audit: unreadable as they were before normalisation.
  const CASES: Array<[string, string]> = [
    ['bleu marine', '#1b2a5e'],
    ['jaune pâle', '#f7f0a8'],
    ['gris moyen', '#808080'],
    ['rouge ShotGrid', '#e5484d'],
    ['vert sombre', '#0b3d1f'],
    ['noir', '#000000'],
    ['blanc', '#ffffff'],
  ];

  for (const isDark of [true, false]) {
    const theme = isDark ? 'sombre' : 'clair';
    for (const [label, hex] of CASES) {
      it(`meets AA in ${theme} theme — ${label}`, () => {
        const swatch = statusSwatch(hex, isDark);
        expect(swatch).not.toBeNull();
        // We check what is really rendered: the background emitted by the helper, composed
        // over the theme surface, and the text colour emitted.
        const surface = isDark ? hslToRgb(223, 28, 10) : hslToRgb(220, 25, 97);
        const composed = mix(parseHsl(swatch!.backgroundColor), surface, 0.15);
        expect(contrastRatio(parseHsl(swatch!.color), composed)).toBeGreaterThanOrEqual(AA_CONTRAST);
      });
    }
  }

  it('keeps the original hue — the status stays recognisable', () => {
    const swatch = statusSwatch('#1b2a5e', true)!;
    const [sourceHue] = rgbToHsl(hexToRgb('#1b2a5e')!);
    const [textHue] = rgbToHsl(parseHsl(swatch.color));
    expect(Math.abs(textHue - sourceHue)).toBeLessThan(2);
  });
});

/** `hsl(H S% L%)` or `hsl(H S% L% / A)` → RGB, to check what the helper produced. */
function parseHsl(value: string): Rgb {
  const [h, s, l] = value.match(/-?[\d.]+/g)!.map(Number);
  return hslToRgb(h, s, l);
}
