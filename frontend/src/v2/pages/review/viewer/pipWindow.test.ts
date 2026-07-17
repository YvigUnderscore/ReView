import { describe, expect, it } from 'vitest';
import { clampPipRect, defaultPipRect, PIP_MIN_WIDTH, toGlRect } from './pipWindow';

const ASPECT = 16 / 9;

describe('defaultPipRect — position initiale du PiP', () => {
  it('coin bas-droit, largeur 28 %, hauteur selon l’aspect', () => {
    const r = defaultPipRect(1000, 600, ASPECT);
    expect(r.w).toBe(280);
    expect(r.h).toBe(Math.round(280 / ASPECT));
    expect(r.x).toBe(1000 - 280 - 10);
    expect(r.y).toBe(600 - r.h - 10);
  });

  it('reste dans un conteneur très petit', () => {
    const r = defaultPipRect(200, 100, ASPECT);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(200);
  });
});

describe('clampPipRect — contraintes de la fenêtre', () => {
  it('borne la largeur au minimum lisible', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 10, h: 5 }, 1000, 600, ASPECT);
    expect(r.w).toBe(PIP_MIN_WIDTH);
    expect(r.h).toBe(Math.round(PIP_MIN_WIDTH / ASPECT));
  });

  it('asservit la hauteur à l’aspect', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 320, h: 999 }, 1000, 600, 2);
    expect(r.h).toBe(160);
  });

  it('réduit la largeur si la hauteur déborde du conteneur', () => {
    const r = clampPipRect({ x: 0, y: 0, w: 900, h: 0 }, 1000, 200, ASPECT);
    expect(r.h).toBeLessThanOrEqual(200);
  });

  it('ramène la position dans le conteneur', () => {
    const r = clampPipRect({ x: 5000, y: -50, w: 300, h: 0 }, 1000, 600, ASPECT);
    expect(r.x).toBe(1000 - r.w);
    expect(r.y).toBe(0);
  });
});

describe('toGlRect — conversion DOM → GL', () => {
  it('inverse l’axe vertical (origine bas-gauche)', () => {
    expect(toGlRect({ x: 20, y: 30, w: 200, h: 100 }, 600)).toEqual({
      x: 20,
      y: 600 - 30 - 100,
      w: 200,
      h: 100,
    });
  });
});
