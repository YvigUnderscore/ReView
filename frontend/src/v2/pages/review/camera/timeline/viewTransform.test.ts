import { describe, expect, it } from 'vitest';
import { fitValueRange, panTime, timeToX, xToTime, valueToY, yToValue, zoomTime } from './viewTransform';

describe('viewTransform — temps ↔ pixel', () => {
  const view = { t0: 0, t1: 1000, width: 200 };
  it('mappe et inverse le temps', () => {
    expect(timeToX(500, view)).toBe(100);
    expect(xToTime(100, view)).toBe(500);
    expect(timeToX(0, view)).toBe(0);
    expect(timeToX(1000, view)).toBe(200);
  });
});

describe('viewTransform — valeur ↔ pixel (Y inversé)', () => {
  const view = { v0: 0, v1: 10, height: 100 };
  it('valeur haute = pixel haut', () => {
    expect(valueToY(10, view)).toBe(0);
    expect(valueToY(0, view)).toBe(100);
    expect(yToValue(0, view)).toBe(10);
    expect(yToValue(100, view)).toBe(0);
  });
});

describe('viewTransform — zoom/pan', () => {
  it('zoomTime avant (factor<1) resserre autour du pivot', () => {
    const z = zoomTime({ t0: 0, t1: 1000, width: 200 }, 500, 0.5);
    expect(z.t0).toBe(250);
    expect(z.t1).toBe(750);
  });
  it('panTime décale la fenêtre', () => {
    const p = panTime({ t0: 0, t1: 1000, width: 200 }, 100);
    expect(p.t0).toBe(100);
    expect(p.t1).toBe(1100);
  });
});

describe('fitValueRange', () => {
  it('englobe avec marge et gère la série constante', () => {
    expect(fitValueRange([0, 10])).toEqual({ v0: -1, v1: 11 });
    const c = fitValueRange([5, 5]);
    expect(c.v0).toBeLessThan(5);
    expect(c.v1).toBeGreaterThan(5);
  });
});
