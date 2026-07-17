import { describe, expect, it } from 'vitest';
import { wipeAngleFromPoint, wipeCenter, wipeClipPoints, wipePosFromPoint } from './wipe';

const area = (pts: [number, number][]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

describe('wipeClipPoints', () => {
  it('barre verticale au centre → moitié droite', () => {
    const pts = wipeClipPoints(0.5, 0, 1000, 500);
    expect(area(pts)).toBeCloseTo(0.5, 6);
    // Tous les points sont dans la moitié droite.
    expect(pts.every(([x]) => x >= 0.5 - 1e-9)).toBe(true);
  });

  it('barre horizontale (90°) au centre → moitié basse', () => {
    const pts = wipeClipPoints(0.5, 90, 800, 600);
    expect(area(pts)).toBeCloseTo(0.5, 6);
    expect(pts.every(([, y]) => y >= 0.5 - 1e-9)).toBe(true);
  });

  it('pos 0 → tout visible, pos 1 → rien', () => {
    expect(area(wipeClipPoints(0, 0, 640, 480))).toBeCloseTo(1, 6);
    expect(area(wipeClipPoints(1, 0, 640, 480))).toBeCloseTo(0, 6);
  });

  it('barre diagonale : polygone valide couvrant environ la moitié', () => {
    const pts = wipeClipPoints(0.5, 45, 1000, 1000);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(area(pts)).toBeCloseTo(0.5, 3);
  });
});

describe('wipePosFromPoint / wipeCenter (aller-retour)', () => {
  it('projection cohérente avec le centre', () => {
    for (const angle of [0, 30, 90, -60]) {
      const [cx, cy] = wipeCenter(0.7, angle, 1200, 700);
      expect(wipePosFromPoint(cx, cy, angle, 1200, 700)).toBeCloseTo(0.7, 6);
    }
  });
  it('borne le résultat dans [0,1]', () => {
    expect(wipePosFromPoint(-5000, 0, 0, 800, 600)).toBe(0);
    expect(wipePosFromPoint(5000, 0, 0, 800, 600)).toBe(1);
  });
});

describe('wipeAngleFromPoint', () => {
  it('poignée au-dessus du centre → 0° (barre verticale), aimanté', () => {
    expect(wipeAngleFromPoint(500, 200, 500, 400)).toBe(0);
    // Légèrement décalé (< 3°) → aimanté à 0.
    expect(wipeAngleFromPoint(505, 200, 500, 400)).toBe(0);
  });
  it('poignée à droite du centre → 90° (barre horizontale)', () => {
    expect(wipeAngleFromPoint(700, 400, 500, 400)).toBe(90);
  });
});
