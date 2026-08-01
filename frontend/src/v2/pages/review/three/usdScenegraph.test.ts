import { describe, it, expect } from 'vitest';
import {
  buildPrimTree,
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
    expect(tree[0]!.children[0]!.children[0]!.path).toBe('/World/Asset/Geo');
  });

  it('crée les niveaux intermédiaires absents plutôt que d’orpheliner la branche', () => {
    // Arbre tronqué : `/World/Asset` manque entre la racine et la feuille.
    const tree = buildPrimTree([prim('/World'), prim('/World/Asset/Geo')]);
    expect(flatten(tree)).toEqual(['/World', '/World/Asset', '/World/Asset/Geo']);
    expect(tree[0]!.children[0]!.type).toBe(''); // nœud implicite, non typé
  });

  it('trie les frères par nom pour un affichage stable', () => {
    const tree = buildPrimTree([prim('/W/b'), prim('/W/a'), prim('/W')]);
    expect(tree[0]!.children.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('conserve les métadonnées du prim réel malgré un nœud implicite préalable', () => {
    const tree = buildPrimTree([
      prim('/World/Asset/Geo'),
      prim('/World/Asset', { type: 'Xform', variantSets: ['modelingVariant'] }),
    ]);
    const asset = tree[0]!.children[0]!;
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
