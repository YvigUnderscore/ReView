// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { pickUsdRootLayer, USD_ROOT_HINTS } from './usdArchive';

describe('pickUsdRootLayer', () => {
  it('returns null when the archive contains no USD file', () => {
    expect(pickUsdRootLayer(['/x/model.fbx', '/x/color.png'])).toBeNull();
  });

  it('returns the single USD layer present', () => {
    expect(pickUsdRootLayer(['/x/tex.png', '/x/asset.usdc'])).toBe('/x/asset.usdc');
  });

  it('prefers the layer nobody references (root .usda + .usdc payloads)', () => {
    // Case that broke before 45.A: MODEL_PRIORITY ranks .usdc before .usda, so a binary payload
    // was opened instead of the ASCII root layer.
    const files = ['/x/scene.usda', '/x/payload/body.usdc', '/x/payload/head.usdc'];
    const deps = [{ layer: 'scene.usda', deps: ['payload/body.usdc', 'payload/head.usdc'] }];
    expect(pickUsdRootLayer(files, { deps })).toBe('/x/scene.usda');
  });

  it('resolves relative dependencies against absolute candidates', () => {
    const files = ['/tmp/unzipped/a/root.usdc', '/tmp/unzipped/a/sub/leaf.usdc'];
    const deps = [{ layer: 'a/root.usdc', deps: ['./sub/leaf.usdc'] }];
    expect(pickUsdRootLayer(files, { deps })).toBe('/tmp/unzipped/a/root.usdc');
  });

  it('without a dependency graph, keeps the shallowest layer', () => {
    const files = ['/x/assets/props/chair.usdc', '/x/shot.usdc'];
    expect(pickUsdRootLayer(files)).toBe('/x/shot.usdc');
  });

  it('breaks ties by archive name at equal depth', () => {
    const files = ['/x/aaa.usdc', '/x/dragon.usdc'];
    expect(pickUsdRootLayer(files, { archiveName: 'dragon.zip' })).toBe('/x/dragon.usdc');
  });

  it('then breaks ties by conventional name, then alphabetically', () => {
    expect(pickUsdRootLayer(['/x/aaa.usdc', '/x/scene.usdc'])).toBe('/x/scene.usdc');
    expect(pickUsdRootLayer(['/x/beta.usdc', '/x/alpha.usdc'])).toBe('/x/alpha.usdc');
    expect(USD_ROOT_HINTS.indexOf('scene')).toBeLessThan(USD_ROOT_HINTS.indexOf('shot'));
  });

  it('does not disqualify a layer that references itself', () => {
    const files = ['/x/scene.usda', '/x/sub/part.usdc'];
    const deps = [
      { layer: 'scene.usda', deps: ['scene.usda', 'sub/part.usdc'] },
      { layer: 'sub/part.usdc', deps: [] },
    ];
    expect(pickUsdRootLayer(files, { deps })).toBe('/x/scene.usda');
  });

  it('falls back to the heuristics when all layers are referenced (cycle)', () => {
    const files = ['/x/a.usdc', '/x/b.usdc'];
    const deps = [
      { layer: 'a.usdc', deps: ['b.usdc'] },
      { layer: 'b.usdc', deps: ['a.usdc'] },
    ];
    expect(pickUsdRootLayer(files, { deps })).toBe('/x/a.usdc');
  });

  it('ignores non-USD files, including usdz archives', () => {
    expect(pickUsdRootLayer(['/x/pack.usdz', '/x/scene.usda'])).toBe('/x/scene.usda');
  });
});
