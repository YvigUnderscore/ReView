// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CULLING_OFF, parseCullingOff, readCullingOff, writeCullingOff } from './cullingDefault';

describe('défaut du culling', () => {
  it('est ACTIF : `off` vaut faux hors préférence', () => {
    // Lot 8 : le culling était neutralisé depuis 10.G-V1. Ce test est la trace du changement.
    expect(DEFAULT_CULLING_OFF).toBe(false);
  });
});

describe('parseCullingOff', () => {
  it('lit les deux valeurs écrites', () => {
    expect(parseCullingOff('1')).toBe(true);
    expect(parseCullingOff('0')).toBe(false);
  });

  it('retombe sur le défaut pour une valeur absente ou illisible', () => {
    expect(parseCullingOff(null)).toBe(DEFAULT_CULLING_OFF);
    expect(parseCullingOff('')).toBe(DEFAULT_CULLING_OFF);
    expect(parseCullingOff('true')).toBe(DEFAULT_CULLING_OFF);
  });
});

describe('mémorisation par utilisateur', () => {
  beforeEach(() => localStorage.clear());

  it('relit ce qui a été écrit — la scène et l’interrupteur du dock lisent la même chose', () => {
    expect(readCullingOff()).toBe(DEFAULT_CULLING_OFF);
    writeCullingOff(true);
    expect(readCullingOff()).toBe(true);
    writeCullingOff(false);
    expect(readCullingOff()).toBe(false);
  });
});
