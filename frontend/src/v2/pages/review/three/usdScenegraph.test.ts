// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  buildPrimTree,
  buildRenderedPrimTree,
  filterPrimTree,
  flattenTree,
  isSelfOrDescendant,
  leafName,
  matchPrimPath,
  parentPath,
  primSegments,
  type PrimNode,
} from './usdScenegraph';
import type { UsdPrim } from '../../../types/api';

const prim = (path: string, over: Partial<UsdPrim> = {}): UsdPrim => ({
  path,
  name: path.split('/').filter(Boolean).at(-1) ?? '',
  type: 'Xform',
  kind: '',
  purpose: '',
  variantSets: [],
  active: true,
  instanceable: false,
  ...over,
});

/** Chemins de tous les nœuds, en profondeur — vue compacte de l'arbre pour les assertions. */
const flatten = (nodes: PrimNode[]): string[] => nodes.flatMap((n) => [n.path, ...flatten(n.children)]);

describe('chemins USD', () => {
  it('découpe, remonte au parent et nomme la feuille', () => {
    expect(primSegments('/World/Asset/Geo')).toEqual(['World', 'Asset', 'Geo']);
    expect(parentPath('/World/Asset/Geo')).toBe('/World/Asset');
    expect(parentPath('/World')).toBeNull();
    expect(leafName('/World/Asset/Geo')).toBe('Geo');
  });

  it('reconnaît un descendant sans confondre les préfixes voisins', () => {
    expect(isSelfOrDescendant('/World/Asset', '/World/Asset')).toBe(true);
    expect(isSelfOrDescendant('/World/Asset/Geo', '/World/Asset')).toBe(true);
    // `/World/AssetB` commence par `/World/Asset` sans en être un descendant.
    expect(isSelfOrDescendant('/World/AssetB', '/World/Asset')).toBe(false);
  });
});

describe('buildPrimTree', () => {
  it('reconstruit la hiérarchie depuis la liste plate', () => {
    const tree = buildPrimTree([prim('/World'), prim('/World/Asset'), prim('/World/Asset/Geo')]);
    expect(flatten(tree)).toEqual(['/World', '/World/Asset', '/World/Asset/Geo']);
    expect(tree[0].children[0].children[0].path).toBe('/World/Asset/Geo');
  });

  it('crée les niveaux intermédiaires absents plutôt que d’orpheliner la branche', () => {
    // Arbre tronqué : `/World/Asset` manque entre la racine et la feuille.
    const tree = buildPrimTree([prim('/World'), prim('/World/Asset/Geo')]);
    expect(flatten(tree)).toEqual(['/World', '/World/Asset', '/World/Asset/Geo']);
    expect(tree[0].children[0].type).toBe(''); // nœud implicite, non typé
  });

  it('trie les frères par nom pour un affichage stable', () => {
    const tree = buildPrimTree([prim('/W/b'), prim('/W/a'), prim('/W')]);
    expect(tree[0].children.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('conserve les métadonnées du prim réel malgré un nœud implicite préalable', () => {
    const tree = buildPrimTree([
      prim('/World/Asset/Geo'),
      prim('/World/Asset', { type: 'Xform', variantSets: ['modelingVariant'] }),
    ]);
    const asset = tree[0].children[0];
    expect(asset.path).toBe('/World/Asset');
    expect(asset.variantSets).toEqual(['modelingVariant']);
    expect(asset.children.map((c) => c.path)).toEqual(['/World/Asset/Geo']);
  });

  it('renvoie un arbre vide sans prim', () => {
    expect(buildPrimTree([])).toEqual([]);
  });
});

describe('matchPrimPath', () => {
  const paths = [
    '/World',
    '/World/Asset',
    '/World/Asset/Geo',
    '/World/Asset/Geo/Geo',
    '/World/Asset/Geo/Geo/Suzanne',
  ];

  it('privilégie l’égalité stricte', () => {
    expect(matchPrimPath('/World/Asset', paths)).toBe('/World/Asset');
  });

  it('absorbe un niveau collapsé par l’importeur Blender', () => {
    // Cas réel : Blender produit `/World/Asset/Geo/Suzanne`, l'USD porte un `Geo` de plus.
    expect(matchPrimPath('/World/Asset/Geo/Suzanne', paths)).toBe('/World/Asset/Geo/Geo/Suzanne');
  });

  it('renvoie null quand aucun prim ne porte ce nom', () => {
    expect(matchPrimPath('/World/Autre', paths)).toBeNull();
  });

  it('renvoie null plutôt que de trancher une ambiguïté', () => {
    // Deux prims homonymes à la même profondeur, sans préfixe commun discriminant.
    expect(matchPrimPath('/X/Mesh', ['/A/Mesh', '/B/Mesh'])).toBeNull();
  });

  it('départage par le préfixe commun le plus long', () => {
    expect(matchPrimPath('/A/B/Mesh', ['/A/B/C/Mesh', '/Z/Mesh'])).toBe('/A/B/C/Mesh');
  });
});

describe('buildRenderedPrimTree', () => {
  it('ajoute des prims implicites pour la géométrie que l’analyseur ne compose pas', () => {
    // L'analyseur compose UNE option par jeu de variantes : la géométrie de l'option `lo`,
    // cuite dans le GLB (46.G), n'existe pas dans sa liste. Sans prim implicite, elle était
    // insélectionnable et l'isolement retombait sur le parent connu le plus proche.
    const tree = buildRenderedPrimTree(
      [prim('/World'), prim('/World/Asset'), prim('/World/Asset/Geo')],
      ['/World/Asset/Geo', '/World/Asset/Geo/Geo/Cube'],
    );
    expect(flatten(tree)).toEqual([
      '/World',
      '/World/Asset',
      '/World/Asset/Geo',
      '/World/Asset/Geo/Geo',
      '/World/Asset/Geo/Geo/Cube',
    ]);
  });

  it('ne duplique pas les prims déjà connus et écarte les artefacts _materials', () => {
    const tree = buildRenderedPrimTree(
      [prim('/World'), prim('/World/Asset')],
      ['/World/Asset', '/World/Asset/_materials'],
    );
    expect(flatten(tree)).toEqual(['/World', '/World/Asset']);
  });

  it('sans chemin rendu, rend l’arbre de l’analyseur tel quel', () => {
    const tree = buildRenderedPrimTree([prim('/World'), prim('/World/Asset')], []);
    expect(flatten(tree)).toEqual(['/World', '/World/Asset']);
  });
});

describe('flattenTree / filterPrimTree', () => {
  const tree = buildPrimTree([
    prim('/root'),
    prim('/root/chairA'),
    prim('/root/chairA/seat'),
    prim('/root/table'),
  ]);

  it('aplatit en pré-ordre (ordre d’affichage) — plage Maj+clic', () => {
    expect(flattenTree(tree)).toEqual(['/root', '/root/chairA', '/root/chairA/seat', '/root/table']);
  });

  it('filtre en gardant les ancêtres des résultats, insensible à la casse', () => {
    expect(flattenTree(filterPrimTree(tree, 'seat'))).toEqual(['/root', '/root/chairA', '/root/chairA/seat']);
    expect(flattenTree(filterPrimTree(tree, 'CHAIR'))).toEqual([
      '/root',
      '/root/chairA',
      '/root/chairA/seat',
    ]);
    expect(filterPrimTree(tree, 'introuvable')).toEqual([]);
    // Requête vide : arbre inchangé (même référence).
    expect(filterPrimTree(tree, '  ')).toBe(tree);
  });
});
