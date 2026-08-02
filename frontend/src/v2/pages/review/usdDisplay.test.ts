// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { initialSelection, unitLabel, variantValue } from './usdDisplay';
import type { UsdModelInfo } from '../../types/api';

const usd = (over: Partial<UsdModelInfo> = {}): UsdModelInfo => ({
  rootLayer: 'scene.usda',
  defaultPrim: '/World',
  upAxis: 'Y',
  metersPerUnit: 1,
  frameRange: null,
  fps: null,
  hasAnimation: false,
  hasSkeleton: false,
  variantSets: [
    { prim: '/World/Asset', name: 'modelingVariant', options: ['hero', 'lo'], selected: 'hero' },
    { prim: '/World/Asset', name: 'lookVariant', options: ['clean', 'dirty'], selected: 'clean' },
  ],
  purposes: ['default'],
  selection: { variants: {}, purpose: 'render' },
  selectionApplied: false,
  missingAssets: [],
  missingAssetsTotal: 0,
  layerCount: 2,
  primCount: 10,
  prims: [],
  primsTruncated: false,
  ...over,
});

describe('unitLabel', () => {
  it('nomme les échelles USD courantes', () => {
    expect(unitLabel(1)).toBe('metre');
    expect(unitLabel(0.01)).toBe('centimetre');
    expect(unitLabel(0.001)).toBe('millimetre');
  });
  it('affiche la valeur brute pour une échelle inhabituelle', () => {
    expect(unitLabel(0.3048)).toBe('0.3048 m');
  });
});

describe('variantValue', () => {
  it('la sélection appliquée prime sur la valeur de la scène', () => {
    expect(variantValue({ '/W/A': { look: 'dirty' } }, '/W/A', 'look', 'clean')).toBe('dirty');
  });
  it('retombe sur la valeur de la scène quand rien n’est sélectionné', () => {
    expect(variantValue({}, '/W/A', 'look', 'clean')).toBe('clean');
    expect(variantValue({ '/W/A': { autre: 'x' } }, '/W/A', 'look', 'clean')).toBe('clean');
  });
});

describe('initialSelection', () => {
  it('pré-remplit chaque jeu de variantes avec sa valeur affichée', () => {
    expect(initialSelection(usd())).toEqual({
      '/World/Asset': { modelingVariant: 'hero', lookVariant: 'clean' },
    });
  });

  it('reprend la sélection déjà appliquée', () => {
    const info = usd({
      selection: { variants: { '/World/Asset': { lookVariant: 'dirty' } }, purpose: 'proxy' },
    });
    expect(initialSelection(info)['/World/Asset']).toEqual({
      modelingVariant: 'hero',
      lookVariant: 'dirty',
    });
  });

  it('renvoie un objet vide sans variantes', () => {
    expect(initialSelection(usd({ variantSets: [] }))).toEqual({});
  });
});
