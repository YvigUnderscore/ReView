// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { pickUsdRootLayer, USD_ROOT_HINTS } from './usdArchive';

describe('pickUsdRootLayer', () => {
  it('renvoie null quand l’archive ne contient aucun fichier USD', () => {
    expect(pickUsdRootLayer(['/x/model.fbx', '/x/color.png'])).toBeNull();
  });

  it('renvoie l’unique couche USD présente', () => {
    expect(pickUsdRootLayer(['/x/tex.png', '/x/asset.usdc'])).toBe('/x/asset.usdc');
  });

  it('préfère la couche que personne ne référence (racine .usda + payloads .usdc)', () => {
    // Cas qui cassait avant 45.A : MODEL_PRIORITY classe .usdc avant .usda, donc un payload
    // binaire était ouvert à la place de la couche racine ASCII.
    const files = ['/x/scene.usda', '/x/payload/body.usdc', '/x/payload/head.usdc'];
    const deps = [{ layer: 'scene.usda', deps: ['payload/body.usdc', 'payload/head.usdc'] }];
    expect(pickUsdRootLayer(files, { deps })).toBe('/x/scene.usda');
  });

  it('résout les dépendances relatives face à des candidats absolus', () => {
    const files = ['/tmp/unzipped/a/root.usdc', '/tmp/unzipped/a/sub/leaf.usdc'];
    const deps = [{ layer: 'a/root.usdc', deps: ['./sub/leaf.usdc'] }];
    expect(pickUsdRootLayer(files, { deps })).toBe('/tmp/unzipped/a/root.usdc');
  });

  it('sans graphe de dépendances, retient la couche la moins profonde', () => {
    const files = ['/x/assets/props/chair.usdc', '/x/shot.usdc'];
    expect(pickUsdRootLayer(files)).toBe('/x/shot.usdc');
  });

  it('départage par le nom de l’archive à profondeur égale', () => {
    const files = ['/x/aaa.usdc', '/x/dragon.usdc'];
    expect(pickUsdRootLayer(files, { archiveName: 'dragon.zip' })).toBe('/x/dragon.usdc');
  });

  it('départage ensuite par nom conventionnel puis alphabétiquement', () => {
    expect(pickUsdRootLayer(['/x/aaa.usdc', '/x/scene.usdc'])).toBe('/x/scene.usdc');
    expect(pickUsdRootLayer(['/x/beta.usdc', '/x/alpha.usdc'])).toBe('/x/alpha.usdc');
    expect(USD_ROOT_HINTS.indexOf('scene')).toBeLessThan(USD_ROOT_HINTS.indexOf('shot'));
  });

  it('ne disqualifie pas une couche qui se référence elle-même', () => {
    const files = ['/x/scene.usda', '/x/sub/part.usdc'];
    const deps = [
      { layer: 'scene.usda', deps: ['scene.usda', 'sub/part.usdc'] },
      { layer: 'sub/part.usdc', deps: [] },
    ];
    expect(pickUsdRootLayer(files, { deps })).toBe('/x/scene.usda');
  });

  it('retombe sur les heuristiques quand toutes les couches sont référencées (cycle)', () => {
    const files = ['/x/a.usdc', '/x/b.usdc'];
    const deps = [
      { layer: 'a.usdc', deps: ['b.usdc'] },
      { layer: 'b.usdc', deps: ['a.usdc'] },
    ];
    expect(pickUsdRootLayer(files, { deps })).toBe('/x/a.usdc');
  });

  it('ignore les fichiers non USD y compris les archives usdz', () => {
    expect(pickUsdRootLayer(['/x/pack.usdz', '/x/scene.usda'])).toBe('/x/scene.usda');
  });
});
