// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  fitValueRange,
  panTime,
  panValue,
  rulerTicks,
  snapToFrame,
  timecode,
  timeToX,
  trackPct,
  xToTime,
  valueToY,
  yToValue,
  zoomTime,
  zoomValue,
} from './viewTransform';

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

  it('zoomValue resserre l’axe des valeurs autour du pivot', () => {
    const z = zoomValue({ v0: 0, v1: 10, height: 100 }, 5, 0.5);
    expect(z.v0).toBe(2.5);
    expect(z.v1).toBe(7.5);
  });

  it('zoomValue garde une étendue non nulle même à l’extrême', () => {
    const z = zoomValue({ v0: 0, v1: 10, height: 100 }, 5, 0);
    expect(z.v1).toBeGreaterThan(z.v0);
  });

  it('panValue décale la fenêtre des valeurs', () => {
    const p = panValue({ v0: 0, v1: 10, height: 100 }, -2);
    expect(p.v0).toBe(-2);
    expect(p.v1).toBe(8);
  });
});

describe('trackPct — tête de lecture bornée à sa piste', () => {
  it('reste dans [0, 100] quel que soit le temps', () => {
    expect(trackPct(500, 1000)).toBe(50);
    expect(trackPct(0, 1000)).toBe(0);
    expect(trackPct(1000, 1000)).toBe(100);
    // Au-delà de la durée, la tête débordait de la piste et faisait apparaître une scrollbar.
    expect(trackPct(60_000, 1000)).toBe(100);
    expect(trackPct(-200, 1000)).toBe(0);
  });

  it('une durée nulle ne divise pas par zéro', () => {
    expect(trackPct(42, 0)).toBe(0);
  });
});

describe('snapToFrame / timecode', () => {
  it('arrondit à la frame la plus proche (24 fps)', () => {
    const frameMs = 1000 / 24;
    expect(snapToFrame(0, 24)).toBe(0);
    expect(snapToFrame(frameMs * 3 + 5, 24)).toBeCloseTo(frameMs * 3, 6);
    expect(snapToFrame(frameMs * 3.6, 24)).toBeCloseTo(frameMs * 4, 6);
    expect(snapToFrame(-50, 24)).toBe(0);
  });
  it('fps invalide : borne à zéro sans snap', () => {
    expect(snapToFrame(123, 0)).toBe(123);
  });
  it('timecode s:ff', () => {
    expect(timecode(0, 24)).toBe('0:00');
    expect(timecode(1000, 24)).toBe('1:00');
    expect(timecode(1000 + 500, 24)).toBe('1:12');
    expect(timecode((1000 / 24) * 30, 24)).toBe('1:06');
  });
});

describe('rulerTicks', () => {
  it('pas étiqueté en frames rondes quand la frame est large', () => {
    // 2 s sur 2000 px à 24 fps : 1 frame ≈ 41,7 px → pas de 2 frames (≥ 70 px), mineurs à la frame.
    const ticks = rulerTicks({ t0: 0, t1: 2000, width: 2000 }, 24);
    expect(ticks.major[0]).toEqual({ t: 0, label: '0:00' });
    const stepMs = ticks.major[1].t - ticks.major[0].t;
    expect(stepMs).toBeCloseTo((1000 / 24) * 2, 6);
    expect(ticks.minor.length).toBeGreaterThan(0);
    // Les mineurs ne doublonnent pas les majeurs.
    for (const m of ticks.minor) expect(ticks.major.some((M) => Math.abs(M.t - m) < 1e-6)).toBe(false);
  });
  it('pas étiqueté en secondes quand la fenêtre est large', () => {
    // 60 s sur 600 px : 1 s = 10 px → pas de 10 s.
    const ticks = rulerTicks({ t0: 0, t1: 60_000, width: 600 }, 24);
    const stepMs = ticks.major[1].t - ticks.major[0].t;
    expect(stepMs).toBe(10_000);
  });
  it('fenêtre vide ou largeur nulle : aucune graduation', () => {
    expect(rulerTicks({ t0: 0, t1: 0, width: 100 }, 24)).toEqual({ major: [], minor: [] });
    expect(rulerTicks({ t0: 0, t1: 1000, width: 0 }, 24)).toEqual({ major: [], minor: [] });
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
