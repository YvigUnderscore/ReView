// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { initialSelection, purposeLabel, unitLabel, variantValue } from './usdDisplay';
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
  it('names the common USD scales', () => {
    expect(unitLabel(1)).toBe('metre');
    expect(unitLabel(0.01)).toBe('centimetre');
    expect(unitLabel(0.001)).toBe('millimetre');
  });
  it('shows the raw value for an unusual scale', () => {
    expect(unitLabel(0.3048)).toBe('0.3048 m');
  });
});

describe('purposeLabel', () => {
  it('names the three purposes of the format', () => {
    expect(purposeLabel('render')).toBe('Render');
    expect(purposeLabel('proxy')).toBe('Proxy');
    expect(purposeLabel('guide')).toBe('Guide');
  });
  it('lets an unknown purpose through as is', () => {
    expect(purposeLabel('default')).toBe('default');
  });
});

describe('variantValue', () => {
  it('the applied selection takes precedence over the scene value', () => {
    expect(variantValue({ '/W/A': { look: 'dirty' } }, '/W/A', 'look', 'clean')).toBe('dirty');
  });
  it('falls back to the scene value when nothing is selected', () => {
    expect(variantValue({}, '/W/A', 'look', 'clean')).toBe('clean');
    expect(variantValue({ '/W/A': { autre: 'x' } }, '/W/A', 'look', 'clean')).toBe('clean');
  });
});

describe('initialSelection', () => {
  it('pre-fills each variant set with its displayed value', () => {
    expect(initialSelection(usd())).toEqual({
      '/World/Asset': { modelingVariant: 'hero', lookVariant: 'clean' },
    });
  });

  it('takes over the selection already applied', () => {
    const info = usd({
      selection: { variants: { '/World/Asset': { lookVariant: 'dirty' } }, purpose: 'proxy' },
    });
    expect(initialSelection(info)['/World/Asset']).toEqual({
      modelingVariant: 'hero',
      lookVariant: 'dirty',
    });
  });

  it('returns an empty object without variants', () => {
    expect(initialSelection(usd({ variantSets: [] }))).toEqual({});
  });
});
