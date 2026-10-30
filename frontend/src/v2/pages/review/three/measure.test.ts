// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { boxLengths, distance3, formatLength, worldToMetres } from './measure';

describe('measure.distance3', () => {
  it('measures the Euclidean distance', () => {
    expect(distance3([0, 0, 0], [3, 4, 0])).toBeCloseTo(5);
    expect(distance3([1, 1, 1], [1, 1, 1])).toBe(0);
  });
});

describe('measure.worldToMetres', () => {
  it('undoes the normalization before converting to meters', () => {
    // Model normalized ×0.5: 1 world unit = 2 file units; file in centimeters.
    expect(worldToMetres(1, 0.5, 0.01)).toBeCloseTo(0.02);
    // Real size (scale 1) and file in meters: the measurement passes through unchanged.
    expect(worldToMetres(2.5, 1, 1)).toBeCloseTo(2.5);
  });

  it('falls back to neutral values rather than NaN or infinity', () => {
    expect(worldToMetres(4, 0, 1)).toBeCloseTo(4);
    expect(worldToMetres(4, Number.NaN, Number.NaN)).toBeCloseTo(4);
    expect(worldToMetres(4, 1, -1)).toBeCloseTo(4);
  });
});

describe('measure.formatLength', () => {
  it('picks the unit that reads naturally rather than scientific notation', () => {
    expect(formatLength(0.0034)).toEqual({ value: 3.4, unit: 'mm' });
    expect(formatLength(0.2)).toEqual({ value: 20, unit: 'cm' });
    expect(formatLength(1.5)).toEqual({ value: 1.5, unit: 'm' });
    expect(formatLength(2500)).toEqual({ value: 2.5, unit: 'km' });
  });

  it('rounds by order of magnitude and ignores the sign', () => {
    expect(formatLength(123.456)).toEqual({ value: 123, unit: 'm' });
    expect(formatLength(12.345)).toEqual({ value: 12.3, unit: 'm' });
    expect(formatLength(-1.234)).toEqual({ value: 1.23, unit: 'm' });
    expect(formatLength(Number.NaN)).toEqual({ value: 0, unit: 'mm' });
  });
});

describe('measure.boxLengths', () => {
  it('converts file dimensions with the scene scale', () => {
    // Scene in centimeters: 180 units = 1.8 m.
    expect(boxLengths([180, 20, 5], 0.01)).toEqual([
      { value: 1.8, unit: 'm' },
      { value: 20, unit: 'cm' },
      { value: 5, unit: 'cm' },
    ]);
  });

  it('treats a missing or aberrant metersPerUnit as "file in meters"', () => {
    expect(boxLengths([2, 2, 2])).toEqual([
      { value: 2, unit: 'm' },
      { value: 2, unit: 'm' },
      { value: 2, unit: 'm' },
    ]);
    expect(boxLengths([2, 2, 2], 0)[0]).toEqual({ value: 2, unit: 'm' });
  });
});
