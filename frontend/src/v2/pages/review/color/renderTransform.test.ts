// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { acquireContext, canvasToObjectUrl, renderTransform } from './renderTransform';
import { FRAGMENT_100, FRAGMENT_300, SHADERS } from './displayShader';
import type { CubeLut } from './cubeLut';

/** Minimal identity LUT: only its size matters for these tests. */
const lut: CubeLut = { size: 2, volume: new Uint8Array(2 * 2 * 2 * 4), source: 'builtin' };

describe('renderTransform — degradation', () => {
  it('returns null without a WebGL context rather than throwing', () => {
    // happy-dom does not implement WebGL: this is exactly the "browser without GPU" case.
    const canvas = document.createElement('canvas');
    expect(acquireContext(canvas)).toBeNull();
    const img = document.createElement('img');
    expect(renderTransform(img, 4, 4, lut)).toBeNull();
  });

  it('refuse une taille nulle', () => {
    const img = document.createElement('img');
    expect(renderTransform(img, 0, 10, lut)).toBeNull();
  });

  it('canvasToObjectUrl returns null when the encoder does not exist', async () => {
    const canvas = document.createElement('canvas');
    // @ts-expect-error — the encoder is deliberately removed to exercise the fallback.
    canvas.toBlob = undefined;
    await expect(canvasToObjectUrl(canvas)).resolves.toBeNull();
  });
});

/**
 * Used to assert the order "exposure -> LUT -> gamma". Exposure and gamma were the two
 * sliders of the Color panel, removed in Phase 50: the test is rewritten for the chain that
 * remains, the studio's own. The image source code serves as the domain of the project LUT,
 * and nothing is applied before or after it.
 */
describe('displayShader — processing chain', () => {
  it('both generations now apply only the LUT', () => {
    for (const flavor of ['webgl2', 'webgl1'] as const) {
      const { fragment } = SHADERS[flavor];
      expect(fragment).toContain('uLut');
      // No review slider remains: neither exposure, gamma, nor a before/after toggle.
      expect(fragment).not.toContain('uExposure');
      expect(fragment).not.toContain('uGamma');
      expect(fragment).not.toContain('uUseLut');
      // Nor any sRGB <-> linear round trip, which only served exposure.
      expect(fragment).not.toContain('rvSrgbToLinear');
    }
  });

  it('WebGL2 samples a 3D texture, WebGL1 a 2D atlas', () => {
    expect(FRAGMENT_300).toContain('sampler3D');
    expect(FRAGMENT_100).not.toContain('sampler3D');
    expect(FRAGMENT_100).toContain('rvSampleTiled');
  });

  it('the LUT sampling is shifted to the centre of the texels', () => {
    expect(FRAGMENT_300).toContain('(uLutSize - 1.0) / uLutSize');
    expect(FRAGMENT_300).toContain('0.5 / uLutSize');
  });

  it('the source alpha passes through the transform', () => {
    expect(FRAGMENT_300).toContain('src.a');
    expect(FRAGMENT_100).toContain('src.a');
  });
});
