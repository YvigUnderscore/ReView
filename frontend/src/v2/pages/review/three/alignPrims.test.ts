// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { alignOffsets, distributeOffsets, type AlignItem } from './alignPrims';

const box = (path: string, x0: number, x1: number): AlignItem => ({
  path,
  min: [x0, 0, 0],
  max: [x1, 1, 1],
});

describe('alignOffsets', () => {
  const items = [box('/a', 0, 2), box('/b', 5, 7), box('/c', 10, 14)];

  it('aligne les min sur le min commun', () => {
    const offsets = alignOffsets(items, 0, 'min');
    expect(offsets).toEqual([
      { path: '/a', offset: 0 },
      { path: '/b', offset: -5 },
      { path: '/c', offset: -10 },
    ]);
  });

  it('aligne les max sur le max commun', () => {
    const offsets = alignOffsets(items, 0, 'max');
    expect(offsets).toEqual([
      { path: '/a', offset: 12 },
      { path: '/b', offset: 7 },
      { path: '/c', offset: 0 },
    ]);
  });

  it('aligne les centres sur le centre de l’ensemble', () => {
    // Ensemble = [0, 14] → centre 7 ; centres actuels : 1, 6, 12.
    const offsets = alignOffsets(items, 0, 'center');
    expect(offsets).toEqual([
      { path: '/a', offset: 6 },
      { path: '/b', offset: 1 },
      { path: '/c', offset: -5 },
    ]);
  });

  it('moins de deux prims : rien à faire', () => {
    expect(alignOffsets([box('/a', 0, 1)], 0, 'min')).toEqual([]);
  });
});

describe('distributeOffsets', () => {
  it('espace les centres régulièrement, extrêmes fixes', () => {
    // Centres : 0, 1, 10 → cible 0, 5, 10.
    const items = [box('/a', -1, 1), box('/b', 0, 2), box('/c', 9, 11)];
    const offsets = distributeOffsets(items, 0);
    expect(offsets).toEqual([
      { path: '/a', offset: 0 },
      { path: '/b', offset: 4 },
      { path: '/c', offset: 0 },
    ]);
  });

  it('moins de trois prims : rien à répartir', () => {
    expect(distributeOffsets([box('/a', 0, 1), box('/b', 2, 3)], 0)).toEqual([]);
  });
});
