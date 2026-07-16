import { describe, it, expect } from 'vitest';
import { tonemapToRgba } from './hdriTonemap';

describe('tonemapToRgba — aperçu HDRI admin', () => {
  it('produit un buffer RGBA opaque à la taille cible', () => {
    const src = new Float32Array(4 * 4 * 4).fill(1);
    const out = tonemapToRgba(src, 4, 4, 2, 2);
    expect(out.length).toBe(2 * 2 * 4);
    expect(out[3]).toBe(255); // alpha opaque
  });

  it('applique Reinhard + gamma (0 → 0, très lumineux → proche de 255)', () => {
    const zero = tonemapToRgba(new Float32Array(4).fill(0), 1, 1, 1, 1);
    expect(zero[0]).toBe(0);
    const bright = tonemapToRgba(new Float32Array(4).fill(1000), 1, 1, 1, 1);
    expect(bright[0]).toBeGreaterThan(250);
    // 1.0 linéaire → 0.5 Reinhard → ~186 après gamma 2.2
    const mid = tonemapToRgba(new Float32Array(4).fill(1), 1, 1, 1, 1);
    expect(mid[0]).toBeGreaterThan(180);
    expect(mid[0]).toBeLessThan(195);
  });

  it('échantillonne la source (nearest) sans déborder', () => {
    // Source 2x1 : pixel gauche noir, pixel droit lumineux.
    const src = new Float32Array(2 * 1 * 4);
    src[4] = src[5] = src[6] = 10;
    const out = tonemapToRgba(src, 2, 1, 2, 1);
    expect(out[0]).toBe(0);
    expect(out[4]).toBeGreaterThan(200);
  });
});
