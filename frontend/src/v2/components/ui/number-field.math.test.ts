// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { clampValue, dragValue, formatValue, parseInput, snapToStep } from './number-field.math';

describe('snapToStep', () => {
  it('arrondit au multiple du pas et nettoie le bruit flottant', () => {
    expect(snapToStep(47.3, 1)).toBe(47);
    expect(snapToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(snapToStep(1.2345, 0.002)).toBe(1.234);
  });
  it('laisse la valeur telle quelle si le pas est nul ou négatif', () => {
    expect(snapToStep(1.234, 0)).toBe(1.234);
  });
});

describe('clampValue', () => {
  const spec = { min: 20, max: 120, step: 1 };
  it('borne aux extrêmes', () => {
    expect(clampValue(5, spec)).toBe(20);
    expect(clampValue(500, spec)).toBe(120);
    expect(clampValue(60.4, spec)).toBe(60);
  });
});

describe('dragValue', () => {
  const spec = { min: -180, max: 180, step: 1, pixelsPerStep: 4 };
  it('convertit les pixels de glissement en pas', () => {
    expect(dragValue(0, 40, spec)).toBe(10); // 40 px / 4 px par pas = 10 pas
    expect(dragValue(0, -40, spec)).toBe(-10);
  });
  it('applique le multiplicateur (Maj ×10) et reste borné', () => {
    expect(dragValue(0, 40, spec, 10)).toBe(100);
    expect(dragValue(170, 400, spec)).toBe(180);
  });
});

describe('parseInput', () => {
  it('accepte la virgule française et rejette le non-numérique', () => {
    expect(parseInput('12,5')).toBe(12.5);
    expect(parseInput(' 47 ')).toBe(47);
    expect(parseInput('abc')).toBeNull();
    expect(parseInput('')).toBeNull();
  });
});

describe('formatValue', () => {
  it('affiche sans décimales inutiles selon le pas', () => {
    expect(formatValue(47, 1)).toBe('47');
    expect(formatValue(0.25, 0.05)).toBe('0,25');
  });
});
