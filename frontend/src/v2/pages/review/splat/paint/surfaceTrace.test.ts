// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  breaksRun,
  distanceToSegment,
  flattenObject,
  pickStroke,
  runNormal,
  strokeCenter,
  worldPerPixel,
  type Projector,
  type SurfaceSample,
} from './surfaceTrace';

const sample = (
  world: [number, number, number],
  depth: number,
  screenStep = 6,
  toCamera: [number, number, number] = [0, 0, 1],
): SurfaceSample => ({ world, object: world, depth, screenStep, toCamera });

const VIEW = { fovDeg: 50, height: 1000 };

describe('worldPerPixel', () => {
  it('grandit avec la profondeur et rétrécit quand la vue est plus haute', () => {
    const near = worldPerPixel(10, 50, 1000);
    expect(near).toBeCloseTo((2 * Math.tan((50 * Math.PI) / 360) * 10) / 1000, 6);
    expect(worldPerPixel(20, 50, 1000)).toBeCloseTo(near * 2, 6);
    expect(worldPerPixel(10, 50, 2000)).toBeCloseTo(near / 2, 6);
  });

  it('ne renvoie jamais de division par zéro', () => {
    expect(Number.isFinite(worldPerPixel(0, 0, 0))).toBe(true);
  });
});

describe('breaksRun — la corde droite au-dessus d’un trou', () => {
  it('laisse passer un déplacement compatible avec le pas écran', () => {
    const a = sample([0, 0, 0], 10);
    const b = sample([0.05, 0, 0], 10);
    expect(breaksRun(a, b, VIEW)).toBe(false);
  });

  it('coupe un saut disproportionné, même à profondeur égale', () => {
    const a = sample([0, 0, 0], 10);
    const b = sample([1, 0, 0], 10);
    expect(breaksRun(a, b, VIEW)).toBe(true);
  });

  it('juge sur la profondeur la plus proche : un bond vers le fond ne se justifie pas lui-même', () => {
    const near = sample([0, 0, 0], 2);
    const far = sample([0, 0, 60], 60);
    expect(breaksRun(near, far, VIEW)).toBe(true);
  });

  it('tolère un geste lent : un pas écran d’un pixel garde un seuil non nul', () => {
    const a = sample([0, 0, 0], 10);
    const b = sample([0.0005, 0, 0], 10, 0);
    expect(breaksRun(a, b, VIEW)).toBe(false);
  });
});

describe('runNormal', () => {
  it('moyenne les directions point → caméra et normalise', () => {
    const n = runNormal([sample([0, 0, 0], 5, 6, [1, 0, 0]), sample([0, 0, 0], 5, 6, [0, 1, 0])]);
    expect(n).not.toBeNull();
    expect(n![0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(n![1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(n![2]).toBeCloseTo(0, 6);
  });

  it('renvoie null quand la moyenne s’annule (aucune orientation exploitable)', () => {
    expect(runNormal([])).toBeNull();
    expect(runNormal([sample([0, 0, 0], 1, 6, [1, 0, 0]), sample([0, 0, 0], 1, 6, [-1, 0, 0])])).toBeNull();
  });
});

describe('flattenObject / strokeCenter', () => {
  it('aplatit les coordonnées objet dans l’ordre du geste', () => {
    expect(flattenObject([sample([1, 2, 3], 1), sample([4, 5, 6], 1)])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('centre = moyenne des points, et [0,0,0] sur un trait vide', () => {
    expect(strokeCenter([0, 0, 0, 2, 2, 2])).toEqual([1, 1, 1]);
    expect(strokeCenter([])).toEqual([0, 0, 0]);
  });
});

describe('distanceToSegment', () => {
  it('mesure la perpendiculaire, et les extrémités quand la projection sort du segment', () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBeCloseTo(3, 6);
    expect(distanceToSegment([-4, 0], [0, 0], [10, 0])).toBeCloseTo(4, 6);
    expect(distanceToSegment([0, 5], [0, 0], [0, 0])).toBeCloseTo(5, 6);
  });
});

describe('pickStroke — le trait sous la gomme', () => {
  // Projecteur d'essai : (x, y) tels quels, et rien derrière la caméra (z > 0).
  const project: Projector = (x, y, z) => (z > 0 ? null : [x, y]);
  const strokes = [
    { points: [0, 0, 0, 100, 0, 0] }, // trait A, horizontal en y = 0
    { points: [0, 50, 0, 100, 50, 0] }, // trait B, horizontal en y = 50
  ];

  it('choisit le trait le plus proche du clic', () => {
    expect(pickStroke(strokes, [50, 3], project)).toBe(0);
    expect(pickStroke(strokes, [50, 47], project)).toBe(1);
  });

  it('ne choisit rien au-delà de la tolérance', () => {
    expect(pickStroke(strokes, [50, 25], project)).toBeNull();
  });

  it('ignore les points derrière la caméra sans relier ce qui les encadre', () => {
    // Deux extrémités visibles séparées par un point derrière : aucun segment ne doit être
    // reconstruit entre elles — sinon la gomme mordrait sur un trait qui n'est pas à l'écran.
    const split = [{ points: [0, 0, 0, 50, 0, 1, 100, 0, 0] }];
    expect(pickStroke(split, [50, 0], project)).toBeNull();
    expect(pickStroke(split, [0, 2], project)).toBe(0);
  });

  it('un trait long ne gagne pas parce qu’il est long', () => {
    const long = [{ points: [0, 40, 0, 1000, 40, 0] }, { points: [48, 0, 0, 52, 0, 0] }];
    expect(pickStroke(long, [50, 2], project)).toBe(1);
  });
});
