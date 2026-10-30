// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  extractJsonLine,
  parseUsdScan,
  parseUsdStageInfo,
  sanitizeVariantSelection,
  type UsdVariantSet,
} from './usdInspect';

const stageJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    root: 'scene.usda',
    stagePath: '/tmp/x/scene.usda',
    defaultPrim: '/World',
    upAxis: 'Y',
    metersPerUnit: 0.01,
    startTimeCode: 1,
    endTimeCode: 96,
    timeCodesPerSecond: 24,
    hasAnimation: true,
    hasSkeleton: false,
    variantSets: [],
    appliedVariants: [],
    purposes: ['default'],
    missingAssets: [],
    missingAssetsTotal: 0,
    layerCount: 3,
    primCount: 42,
    ...over,
  });

describe('extractJsonLine', () => {
  it('keeps the last JSON line and ignores the noise', () => {
    const out = 'Warning: plugin obsolète\n{"layers": []}\n';
    expect(extractJsonLine(out)).toBe('{"layers": []}');
    expect(extractJsonLine('{"a":1}\n{"b":2}')).toBe('{"b":2}');
  });

  it('fails explicitly without JSON output', () => {
    expect(() => extractJsonLine('rien du tout')).toThrow(/no usable JSON output/);
    expect(() => extractJsonLine('')).toThrow();
  });
});

describe('parseUsdScan', () => {
  it('reads the layer graph and fills in missing dependencies', () => {
    const layers = parseUsdScan('{"layers":[{"layer":"scene.usda","deps":["a.usdc"]},{"layer":"a.usdc"}]}');
    expect(layers).toEqual([
      { layer: 'scene.usda', deps: ['a.usdc'] },
      { layer: 'a.usdc', deps: [] },
    ]);
  });

  it('rejects malformed output', () => {
    expect(() => parseUsdScan('{"layers":[{"deps":[]}]}')).toThrow(/invalid layer graph/);
  });
});

describe('parseUsdStageInfo', () => {
  it('reads a complete description', () => {
    const info = parseUsdStageInfo(stageJson());
    expect(info.root).toBe('scene.usda');
    expect(info.metersPerUnit).toBe(0.01);
    expect(info.hasAnimation).toBe(true);
  });

  it('normalizes the up axis to Y or Z', () => {
    expect(parseUsdStageInfo(stageJson({ upAxis: 'Z' })).upAxis).toBe('Z');
    expect(parseUsdStageInfo(stageJson({ upAxis: 'y' })).upAxis).toBe('Y');
    expect(parseUsdStageInfo(stageJson({ upAxis: 'inconnu' })).upAxis).toBe('Y');
  });

  it('deduplicates the variantSets and the missing assets', () => {
    const info = parseUsdStageInfo(
      stageJson({
        variantSets: [
          { prim: '/W/A', name: 'look', options: ['a', 'b'], selected: 'a' },
          { prim: '/W/A', name: 'look', options: ['a', 'b'], selected: 'a' },
          { prim: '/W/B', name: 'look', options: ['a'], selected: 'a' },
        ],
        missingAssets: ['tex/diffuse.exr', 'tex/diffuse.exr', 'tex/rough.exr'],
      }),
    );
    expect(info.variantSets).toHaveLength(2);
    expect(info.missingAssets).toEqual(['tex/diffuse.exr', 'tex/rough.exr']);
  });

  it('surfaces the material paths, empty by default', () => {
    // They feed the import mask of the baked variants (46.G): without them, a material stored
    // outside the baked subtree is missing from the stage and the object comes out unbound.
    expect(parseUsdStageInfo(stageJson({ materialPaths: ['/W/mtl/wood'] })).materialPaths).toEqual([
      '/W/mtl/wood',
    ]);
    expect(parseUsdStageInfo(stageJson()).materialPaths).toEqual([]);
  });

  it('rejects a description without a root layer', () => {
    expect(() => parseUsdStageInfo('{"stagePath":"/tmp/x"}')).toThrow(/invalid scene description/);
  });
});

describe('sanitizeVariantSelection', () => {
  const known: UsdVariantSet[] = [
    { prim: '/W/Asset', name: 'modelingVariant', options: ['hero', 'lo'], selected: 'hero' },
    { prim: '/W/Asset', name: 'lookVariant', options: ['clean', 'dirty'], selected: 'clean' },
  ];

  it('keeps only the selections actually offered by the scene', () => {
    expect(
      sanitizeVariantSelection(
        {
          '/W/Asset': { modelingVariant: 'lo', lookVariant: 'inexistant', autre: 'x' },
          '/W/Inconnu': { modelingVariant: 'hero' },
        },
        known,
      ),
    ).toEqual({ '/W/Asset': { modelingVariant: 'lo' } });
  });

  it('returns an empty object when nothing matches', () => {
    expect(sanitizeVariantSelection({ '/X': { y: 'z' } }, known)).toEqual({});
    expect(sanitizeVariantSelection({}, known)).toEqual({});
  });
});
