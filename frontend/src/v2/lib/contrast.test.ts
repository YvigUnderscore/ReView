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
  it('lit les deux formes hexadécimales, avec ou sans dièse', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb('000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#F00')).toEqual([1, 0, 0]);
  });

  it('rejette ce qui n’est pas une couleur', () => {
    expect(hexToRgb('')).toBeNull();
    expect(hexToRgb('rouge')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });

  it('fait l’aller-retour RVB ↔ TSL', () => {
    const [h, s, l] = rgbToHsl([1, 0, 0]);
    expect(Math.round(h)).toBe(0);
    expect(Math.round(s)).toBe(100);
    expect(Math.round(l)).toBe(50);
    const back = hslToRgb(h, s, l);
    expect(back.map((v) => Math.round(v * 255))).toEqual([255, 0, 0]);
  });

  it('rend le gris sans teinte ni saturation', () => {
    expect(rgbToHsl([0.5, 0.5, 0.5])).toEqual([0, 0, 50]);
  });
});

describe('contrastRatio', () => {
  it('donne 21 pour noir sur blanc et 1 pour une couleur sur elle-même', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('est symétrique', () => {
    const a = hslToRgb(200, 80, 40);
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10);
  });

  it('classe le blanc comme le plus lumineux', () => {
    expect(relativeLuminance(WHITE)).toBeGreaterThan(relativeLuminance(BLACK));
  });
});

describe('mix', () => {
  it('interpole entre premier plan et fond', () => {
    expect(mix(WHITE, BLACK, 0.5)).toEqual([0.5, 0.5, 0.5]);
    expect(mix(WHITE, BLACK, 0)).toEqual(BLACK);
    expect(mix(WHITE, BLACK, 1)).toEqual(WHITE);
  });
});

describe('readableLightness', () => {
  it('éclaircit sur fond sombre et assombrit sur fond clair', () => {
    const onDark = readableLightness(220, 80, 30, hslToRgb(223, 28, 10), true);
    expect(onDark).toBeGreaterThan(30);
    const onLight = readableLightness(50, 90, 80, hslToRgb(220, 25, 97), false);
    expect(onLight).toBeLessThan(80);
  });

  it('ne bouge pas une couleur déjà lisible', () => {
    const bg = hslToRgb(223, 28, 10);
    const already = readableLightness(184, 100, 50, bg, true);
    expect(already).toBe(50);
  });
});

describe('statusSwatch', () => {
  it('renvoie null sans couleur exploitable', () => {
    expect(statusSwatch(null, true)).toBeNull();
    expect(statusSwatch(undefined, false)).toBeNull();
    expect(statusSwatch('pas-une-couleur', true)).toBeNull();
  });

  // Les deux cas cités par l'audit : illisibles tels quels avant normalisation.
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
      it(`tient AA en thème ${theme} — ${label}`, () => {
        const swatch = statusSwatch(hex, isDark);
        expect(swatch).not.toBeNull();
        // On vérifie ce qui est réellement rendu : le fond émis par le helper, composé
        // sur la surface du thème, et la couleur de texte émise.
        const surface = isDark ? hslToRgb(223, 28, 10) : hslToRgb(220, 25, 97);
        const composed = mix(parseHsl(swatch!.backgroundColor), surface, 0.15);
        expect(contrastRatio(parseHsl(swatch!.color), composed)).toBeGreaterThanOrEqual(AA_CONTRAST);
      });
    }
  }

  it('conserve la teinte d’origine — le statut reste reconnaissable', () => {
    const swatch = statusSwatch('#1b2a5e', true)!;
    const [sourceHue] = rgbToHsl(hexToRgb('#1b2a5e')!);
    const [textHue] = rgbToHsl(parseHsl(swatch.color));
    expect(Math.abs(textHue - sourceHue)).toBeLessThan(2);
  });
});

/** `hsl(H S% L%)` ou `hsl(H S% L% / A)` → RVB, pour vérifier ce que le helper a produit. */
function parseHsl(value: string): Rgb {
  const [h, s, l] = value.match(/-?[\d.]+/g)!.map(Number);
  return hslToRgb(h, s, l);
}
