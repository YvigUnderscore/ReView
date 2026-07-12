import { describe, expect, it } from 'vitest';
import { reviewFrame, DEFAULT_REVIEW_ASPECT } from './frameRect';

describe('reviewFrame — letterbox à aspect fixe (V6)', () => {
  it('conteneur plus haut que le cadre : largeur pleine, bandes horizontales, centré', () => {
    // container 1920×1280 (aspect 1.5) < 16/9 (1.78) → largeur pleine, letterbox haut/bas.
    const r = reviewFrame(16 / 9, 1920, 1280);
    expect(r.width).toBe(1920);
    expect(r.height).toBeCloseTo(1080);
    expect(r.top).toBeCloseTo(100);
    expect(r.left).toBe(0);
  });

  it('conteneur plus large que le cadre : hauteur pleine, bandes latérales', () => {
    const r = reviewFrame(16 / 9, 2000, 900); // aspect 2.22 > 1.78 → hauteur pleine
    expect(r.height).toBe(900);
    expect(r.width).toBeCloseTo(1600);
    expect(r.left).toBeCloseTo(200);
    expect(r.top).toBe(0);
  });

  it('aspect égal au conteneur : remplit sans bande', () => {
    const r = reviewFrame(2, 800, 400);
    expect(r).toEqual({ left: 0, top: 0, width: 800, height: 400 });
  });

  it('dimensions/aspect invalides : remplit le conteneur (repli neutre)', () => {
    expect(reviewFrame(0, 800, 400)).toEqual({ left: 0, top: 0, width: 800, height: 400 });
    expect(reviewFrame(NaN, 800, 400)).toEqual({ left: 0, top: 0, width: 800, height: 400 });
    expect(reviewFrame(1.5, 0, 400)).toEqual({ left: 0, top: 0, width: 0, height: 400 });
  });

  it('expose un aspect par défaut 16:9', () => {
    expect(DEFAULT_REVIEW_ASPECT).toBeCloseTo(16 / 9);
  });
});
