import { describe, expect, it } from 'vitest';
import { pipRect } from './useModelLayout';

describe('pipRect — rectangle du PiP layout', () => {
  it('coin bas-droit, largeur = fraction, aspect 16:9', () => {
    const r = pipRect(1000, 600, 0.28, 10);
    expect(r.w).toBe(280);
    expect(r.h).toBe(Math.round(280 / (16 / 9)));
    expect(r.x).toBe(1000 - 280 - 10);
    expect(r.y).toBe(10); // depuis le bas (coords GL)
  });

  it('borne la largeur pour laisser les marges sur un très petit viewport', () => {
    const r = pipRect(40, 30, 0.28, 10);
    expect(r.w).toBeLessThanOrEqual(40 - 2 * 10);
    expect(r.x).toBeGreaterThanOrEqual(10);
  });
});
