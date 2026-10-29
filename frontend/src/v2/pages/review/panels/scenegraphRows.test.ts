// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { aimedPrimPath, buildRows, rowIndexOf, variantTitleIndex } from './scenegraphRows';
import { buildPrimTree } from '../three/usdScenegraph';
import { IDENTITY_TRANSFORM, addClone, emptyOverride } from '../three/sceneOverride';
import type { UsdModelInfo, UsdPrim } from '../../../types/api';

/**
 * Arithmetic of the scenegraph rows.
 *
 * What is verified here: only what is expanded gets flattened (that is the whole point: the virtualizer
 * can only count rows), the search expands only the path leading to its results, clones stay under their
 * source prim, and variant sets are indexed once instead of being re-filtered per row.
 */

const prim = (path: string): UsdPrim => ({
  path,
  name: path.split('/').at(-1) ?? '',
  type: 'Xform',
  kind: '',
  purpose: '',
  variantSets: [],
  active: true,
  instanceable: false,
});

const tree = buildPrimTree(['/World/A/A1', '/World/A/A2', '/World/B'].map(prim));

describe('buildRows — flattening the visible tree', () => {
  it('leaves out of the rows the children of a collapsed node', () => {
    const rows = buildRows(tree, new Set(['/World']), emptyOverride());
    expect(rows.map((r) => r.path)).toEqual(['/World', '/World/A', '/World/B']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
    // The chevron only opens where there are children.
    expect(rows.map((r) => r.kind === 'prim' && r.open)).toEqual([true, false, false]);
  });

  it('forcibly expands the path leading to the result, and that path only', () => {
    // `forceOpen` comes from `searchPrimTree`: it is the lineage of the matches. `/World/A` opens because
    // one searches beneath it; `/World/B`, collapsed, stays so.
    const rows = buildRows(tree, new Set(), emptyOverride(), new Set(['/World', '/World/A']));
    expect(rows.map((r) => r.path)).toEqual(['/World', '/World/A', '/World/A/A1', '/World/A/A2', '/World/B']);
  });

  it('combines the user expansion and the search expansion', () => {
    const rows = buildRows(tree, new Set(['/World']), emptyOverride(), new Set(['/World/A']));
    expect(rows.map((r) => r.path)).toEqual(['/World', '/World/A', '/World/A/A1', '/World/A/A2', '/World/B']);
  });

  it('places clones just under their source prim, one step to the right', () => {
    const override = addClone(emptyOverride(), '/World/B', { id: 'c1', transform: IDENTITY_TRANSFORM });
    const rows = buildRows(tree, new Set(['/World']), override);
    expect(rows.map((r) => `${r.kind}:${r.path}`)).toEqual([
      'prim:/World',
      'prim:/World/A',
      'prim:/World/B',
      'clone:/World/B#c1',
    ]);
    expect(rows.at(-1)?.depth).toBe(2);
  });
});

describe('rowIndexOf — scrolling to a prim requires an index', () => {
  const rows = buildRows(tree, new Set(['/World', '/World/A']), emptyOverride());

  it('locates the row of an expanded prim', () => {
    expect(rowIndexOf(rows, '/World/A/A2')).toBe(3);
  });

  it('returns -1 for a prim with no row (collapsed branch, nothing selected)', () => {
    expect(rowIndexOf(buildRows(tree, new Set(), emptyOverride()), '/World/A/A2')).toBe(-1);
    expect(rowIndexOf(rows, null)).toBe(-1);
  });
});

describe('variantTitleIndex — a single pass over the variantSets', () => {
  const usd = {
    variantSets: [
      { prim: '/World/A', name: 'modelingVariant', options: ['hero', 'lo'], selected: 'hero' },
      { prim: '/World/A', name: 'lookVariant', options: ['clean', 'dirty'], selected: 'clean' },
      { prim: '/World/B', name: 'lodVariant', options: ['high'], selected: 'high' },
    ],
  } as UsdModelInfo;

  it('joins the sets of the same prim in catalogue order', () => {
    const index = variantTitleIndex(usd);
    expect(index.get('/World/A')).toBe('modelingVariant, lookVariant');
    expect(index.get('/World/B')).toBe('lodVariant');
    expect(index.has('/World')).toBe(false);
  });

  it('reads the list only once, whatever the number of rows', () => {
    let reads = 0;
    const sets = usd.variantSets;
    const watched = {
      get variantSets() {
        reads += 1;
        return sets;
      },
    } as UsdModelInfo;
    variantTitleIndex(watched);
    expect(reads).toBe(1);
  });

  it('handles a scene without variants', () => {
    expect(variantTitleIndex(null).size).toBe(0);
  });
});

describe('aimedPrimPath — the row targeted by the right-click', () => {
  it('climbs from the row content up to its prim', () => {
    const row = document.createElement('div');
    row.setAttribute('data-prim-path', '/World/A');
    const icon = document.createElement('span');
    row.appendChild(icon);
    document.body.appendChild(row);
    expect(aimedPrimPath(icon)).toBe('/World/A');
    row.remove();
  });

  it('targets nothing outside a prim row (empty area, clone row)', () => {
    const clone = document.createElement('div');
    document.body.appendChild(clone);
    expect(aimedPrimPath(clone)).toBeNull();
    expect(aimedPrimPath(null)).toBeNull();
    clone.remove();
  });
});
