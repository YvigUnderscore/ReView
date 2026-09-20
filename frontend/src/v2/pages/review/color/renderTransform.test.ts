// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { acquireContext, canvasToObjectUrl, renderTransform } from './renderTransform';
import { FRAGMENT_100, FRAGMENT_300, SHADERS } from './displayShader';
import type { CubeLut } from './cubeLut';

/** LUT identité minimale — seule sa taille compte pour ces tests. */
const lut: CubeLut = { size: 2, volume: new Uint8Array(2 * 2 * 2 * 4), source: 'builtin' };

describe('renderTransform — dégradation', () => {
  it('rend null sans contexte WebGL plutôt que de lever', () => {
    // happy-dom n'implémente pas WebGL : c'est exactement le cas « navigateur sans GPU ».
    const canvas = document.createElement('canvas');
    expect(acquireContext(canvas)).toBeNull();
    const img = document.createElement('img');
    expect(renderTransform(img, 4, 4, lut)).toBeNull();
  });

  it('refuse une taille nulle', () => {
    const img = document.createElement('img');
    expect(renderTransform(img, 0, 10, lut)).toBeNull();
  });

  it('canvasToObjectUrl rend null quand l’encodage n’existe pas', async () => {
    const canvas = document.createElement('canvas');
    // @ts-expect-error — on retire volontairement l'encodeur pour éprouver le repli.
    canvas.toBlob = undefined;
    await expect(canvasToObjectUrl(canvas)).resolves.toBeNull();
  });
});

/**
 * Ce test affirmait l'ordre « exposition → LUT → gamma ». L'exposition et le gamma étaient les
 * deux curseurs du panneau Color, retiré en Phase 50 : il est réécrit sur la chaîne qui reste,
 * celle du studio — le code source de l'image sert de domaine à la LUT du projet, et rien ne
 * s'applique avant ni après.
 */
describe('displayShader — chaîne de traitement', () => {
  it('les deux générations n’appliquent plus que la LUT', () => {
    for (const flavor of ['webgl2', 'webgl1'] as const) {
      const { fragment } = SHADERS[flavor];
      expect(fragment).toContain('uLut');
      // Plus aucun curseur de review : ni exposition, ni gamma, ni bascule avant/après.
      expect(fragment).not.toContain('uExposure');
      expect(fragment).not.toContain('uGamma');
      expect(fragment).not.toContain('uUseLut');
      // Et plus d'aller-retour sRGB ↔ linéaire, qui ne servait qu'à l'exposition.
      expect(fragment).not.toContain('rvSrgbToLinear');
    }
  });

  it('WebGL2 échantillonne une texture 3D, WebGL1 un atlas 2D', () => {
    expect(FRAGMENT_300).toContain('sampler3D');
    expect(FRAGMENT_100).not.toContain('sampler3D');
    expect(FRAGMENT_100).toContain('rvSampleTiled');
  });

  it('l’échantillonnage de la LUT est recadré au centre des texels', () => {
    expect(FRAGMENT_300).toContain('(uLutSize - 1.0) / uLutSize');
    expect(FRAGMENT_300).toContain('0.5 / uLutSize');
  });

  it('l’alpha de la source traverse la transformée', () => {
    expect(FRAGMENT_300).toContain('src.a');
    expect(FRAGMENT_100).toContain('src.a');
  });
});
