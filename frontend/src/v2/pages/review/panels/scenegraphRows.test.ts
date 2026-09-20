// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { aimedPrimPath, buildRows, rowIndexOf, variantTitleIndex } from './scenegraphRows';
import { buildPrimTree } from '../three/usdScenegraph';
import { IDENTITY_TRANSFORM, addClone, emptyOverride } from '../three/sceneOverride';
import type { UsdModelInfo, UsdPrim } from '../../../types/api';

/**
 * L'arithmétique des rangées du scenegraph.
 *
 * Ce qui est vérifié ici : on n'aplatit que ce qui est déplié (c'est tout l'intérêt — le
 * virtualiseur ne sait compter que des rangées), la recherche ne déplie que le chemin menant à
 * ses résultats, les clones restent sous leur prim source, et les jeux de variantes sont
 * indexés une fois au lieu d'être refiltrés par rangée.
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

describe('buildRows — aplatissement de l’arbre visible', () => {
  it('laisse hors des rangées les enfants d’un nœud replié', () => {
    const rows = buildRows(tree, new Set(['/World']), emptyOverride());
    expect(rows.map((r) => r.path)).toEqual(['/World', '/World/A', '/World/B']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
    // Le chevron ne s'ouvre que là où il y a des enfants.
    expect(rows.map((r) => r.kind === 'prim' && r.open)).toEqual([true, false, false]);
  });

  it('déplie de force le chemin menant au résultat, et lui seul', () => {
    // `forceOpen` vient de `searchPrimTree` : c'est la lignée des correspondances. `/World/A`
    // s'ouvre parce qu'on cherche sous lui ; `/World/B`, replié, le reste.
    const rows = buildRows(tree, new Set(), emptyOverride(), new Set(['/World', '/World/A']));
    expect(rows.map((r) => r.path)).toEqual(['/World', '/World/A', '/World/A/A1', '/World/A/A2', '/World/B']);
  });

  it('cumule le dépliage de l’utilisateur et celui de la recherche', () => {
    const rows = buildRows(tree, new Set(['/World']), emptyOverride(), new Set(['/World/A']));
    expect(rows.map((r) => r.path)).toEqual(['/World', '/World/A', '/World/A/A1', '/World/A/A2', '/World/B']);
  });

  it('range les clones juste sous leur prim source, un cran à droite', () => {
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

describe('rowIndexOf — défiler jusqu’à un prim demande un index', () => {
  const rows = buildRows(tree, new Set(['/World', '/World/A']), emptyOverride());

  it('situe la rangée d’un prim déplié', () => {
    expect(rowIndexOf(rows, '/World/A/A2')).toBe(3);
  });

  it('rend -1 pour un prim sans rangée (branche repliée, rien de sélectionné)', () => {
    expect(rowIndexOf(buildRows(tree, new Set(), emptyOverride()), '/World/A/A2')).toBe(-1);
    expect(rowIndexOf(rows, null)).toBe(-1);
  });
});

describe('variantTitleIndex — un seul passage sur les variantSets', () => {
  const usd = {
    variantSets: [
      { prim: '/World/A', name: 'modelingVariant', options: ['hero', 'lo'], selected: 'hero' },
      { prim: '/World/A', name: 'lookVariant', options: ['clean', 'dirty'], selected: 'clean' },
      { prim: '/World/B', name: 'lodVariant', options: ['high'], selected: 'high' },
    ],
  } as UsdModelInfo;

  it('joint les jeux d’un même prim dans l’ordre du catalogue', () => {
    const index = variantTitleIndex(usd);
    expect(index.get('/World/A')).toBe('modelingVariant, lookVariant');
    expect(index.get('/World/B')).toBe('lodVariant');
    expect(index.has('/World')).toBe(false);
  });

  it('ne lit la liste qu’une fois, quel que soit le nombre de rangées', () => {
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

  it('tient la scène sans variantes', () => {
    expect(variantTitleIndex(null).size).toBe(0);
  });
});

describe('aimedPrimPath — la rangée visée par le clic droit', () => {
  it('remonte du contenu de la rangée jusqu’à son prim', () => {
    const row = document.createElement('div');
    row.setAttribute('data-prim-path', '/World/A');
    const icon = document.createElement('span');
    row.appendChild(icon);
    document.body.appendChild(row);
    expect(aimedPrimPath(icon)).toBe('/World/A');
    row.remove();
  });

  it('ne vise rien hors d’une rangée de prim (zone vide, rangée de clone)', () => {
    const clone = document.createElement('div');
    document.body.appendChild(clone);
    expect(aimedPrimPath(clone)).toBeNull();
    expect(aimedPrimPath(null)).toBeNull();
    clone.remove();
  });
});
