// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { acquireContext, canvasToObjectUrl, renderTransform } from './renderTransform';
import { FRAGMENT_100, FRAGMENT_300, SHADERS } from './displayShader';

describe('renderTransform — dégradation', () => {
  it('rend null sans contexte WebGL plutôt que de lever', () => {
    // happy-dom n'implémente pas WebGL : c'est exactement le cas « navigateur sans GPU ».
    const canvas = document.createElement('canvas');
    expect(acquireContext(canvas)).toBeNull();
    const img = document.createElement('img');
    expect(renderTransform(img, 4, 4, { exposure: 0, gamma: 1, lut: null })).toBeNull();
  });

  it('refuse une taille nulle', () => {
    const img = document.createElement('img');
    expect(renderTransform(img, 0, 10, { exposure: 1, gamma: 1, lut: null })).toBeNull();
  });

  it('canvasToObjectUrl rend null quand l’encodage n’existe pas', async () => {
    const canvas = document.createElement('canvas');
    // @ts-expect-error — on retire volontairement l'encodeur pour éprouver le repli.
    canvas.toBlob = undefined;
    await expect(canvasToObjectUrl(canvas)).resolves.toBeNull();
  });
});

describe('displayShader — chaîne de traitement', () => {
  it('les deux générations appliquent exposition, LUT et gamma dans cet ordre', () => {
    for (const flavor of ['webgl2', 'webgl1'] as const) {
      // Seul le corps de `main` décrit l'ordre : les déclarations, elles, viennent avant.
      const body = SHADERS[flavor].fragment.slice(SHADERS[flavor].fragment.indexOf('void main'));
      expect(body).toContain('rvExpose');
      expect(body.indexOf('uUseLut')).toBeGreaterThan(body.indexOf('rvExpose'));
      expect(body.indexOf('rvViewGamma')).toBeGreaterThan(body.indexOf('uUseLut'));
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
});
