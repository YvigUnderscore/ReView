// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { reviewFrame, frameViewOffset, shapesOutsideFrame, DEFAULT_REVIEW_ASPECT } from './frameRect';

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

describe('frameViewOffset — vue caméra étendue au conteneur (Phase 25)', () => {
  it('conteneur plus large : pleine vue = guide, sous-vue élargie centrée (offset x négatif)', () => {
    const v = frameViewOffset(16 / 9, 2000, 900);
    expect(v.fullWidth).toBeCloseTo(1600);
    expect(v.fullHeight).toBe(900);
    expect(v.x).toBeCloseTo(-200);
    expect(v.y).toBe(0);
    expect(v.width).toBe(2000);
    expect(v.height).toBe(900);
  });

  it('conteneur plus haut : offset y négatif, largeur pleine', () => {
    const v = frameViewOffset(16 / 9, 1920, 1280);
    expect(v.fullWidth).toBe(1920);
    expect(v.fullHeight).toBeCloseTo(1080);
    expect(v.x).toBe(0);
    expect(v.y).toBeCloseTo(-100);
  });

  it('aspect égal : sous-vue = pleine vue (offsets nuls)', () => {
    const v = frameViewOffset(2, 800, 400);
    expect(v).toEqual({ fullWidth: 800, fullHeight: 400, x: 0, y: 0, width: 800, height: 400 });
  });
});

describe('shapesOutsideFrame — dessin hors cadre de livraison (Phase 25)', () => {
  it('détecte un tracé, un rectangle ou une flèche qui déborde', () => {
    expect(
      shapesOutsideFrame([
        {
          type: 'path',
          pts: [
            [0.5, 0.5],
            [1.2, 0.4],
          ],
        },
      ]),
    ).toBe(true);
    expect(shapesOutsideFrame([{ type: 'rect', x: 0.8, y: 0.2, w: 0.4, h: 0.1 }])).toBe(true);
    expect(shapesOutsideFrame([{ type: 'arrow', x1: 0.1, y1: 0.1, x2: -0.2, y2: 0.5 }])).toBe(true);
    expect(shapesOutsideFrame([{ type: 'ellipse', cx: 0.05, cy: 0.5, rx: 0.2, ry: 0.1 }])).toBe(true);
  });

  it('ne signale rien pour des formes entièrement dans le cadre', () => {
    expect(
      shapesOutsideFrame([
        {
          type: 'path',
          pts: [
            [0.1, 0.1],
            [0.9, 0.9],
          ],
        },
        { type: 'rect', x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
        { type: 'text', x: 0.5, y: 0.5 },
      ]),
    ).toBe(false);
  });
});
