// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { boxLengths, distance3, formatLength, worldToMetres } from './measure';

describe('measure.distance3', () => {
  it('mesure la distance euclidienne', () => {
    expect(distance3([0, 0, 0], [3, 4, 0])).toBeCloseTo(5);
    expect(distance3([1, 1, 1], [1, 1, 1])).toBe(0);
  });
});

describe('measure.worldToMetres', () => {
  it('défait la normalisation avant de convertir en mètres', () => {
    // Modèle normalisé ×0,5 : 1 unité monde = 2 unités fichier ; fichier en centimètres.
    expect(worldToMetres(1, 0.5, 0.01)).toBeCloseTo(0.02);
    // Taille réelle (échelle 1) et fichier en mètres : la mesure passe telle quelle.
    expect(worldToMetres(2.5, 1, 1)).toBeCloseTo(2.5);
  });

  it('tombe sur des valeurs neutres plutôt que sur NaN ou l’infini', () => {
    expect(worldToMetres(4, 0, 1)).toBeCloseTo(4);
    expect(worldToMetres(4, Number.NaN, Number.NaN)).toBeCloseTo(4);
    expect(worldToMetres(4, 1, -1)).toBeCloseTo(4);
  });
});

describe('measure.formatLength', () => {
  it('choisit l’unité lisible par le métier plutôt que la notation scientifique', () => {
    expect(formatLength(0.0034)).toEqual({ value: 3.4, unit: 'mm' });
    expect(formatLength(0.2)).toEqual({ value: 20, unit: 'cm' });
    expect(formatLength(1.5)).toEqual({ value: 1.5, unit: 'm' });
    expect(formatLength(2500)).toEqual({ value: 2.5, unit: 'km' });
  });

  it('arrondit selon l’ordre de grandeur et ignore le signe', () => {
    expect(formatLength(123.456)).toEqual({ value: 123, unit: 'm' });
    expect(formatLength(12.345)).toEqual({ value: 12.3, unit: 'm' });
    expect(formatLength(-1.234)).toEqual({ value: 1.23, unit: 'm' });
    expect(formatLength(Number.NaN)).toEqual({ value: 0, unit: 'mm' });
  });
});

describe('measure.boxLengths', () => {
  it('convertit les dimensions du fichier avec son échelle de scène', () => {
    // Scène en centimètres : 180 unités = 1,8 m.
    expect(boxLengths([180, 20, 5], 0.01)).toEqual([
      { value: 1.8, unit: 'm' },
      { value: 20, unit: 'cm' },
      { value: 5, unit: 'cm' },
    ]);
  });

  it('traite un metersPerUnit absent ou aberrant comme « fichier en mètres »', () => {
    expect(boxLengths([2, 2, 2])).toEqual([
      { value: 2, unit: 'm' },
      { value: 2, unit: 'm' },
      { value: 2, unit: 'm' },
    ]);
    expect(boxLengths([2, 2, 2], 0)[0]).toEqual({ value: 2, unit: 'm' });
  });
});
