// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  ancestorPaths,
  buildPrimTree,
  buildRenderedPrimTree,
  flattenTree,
  initialExpansion,
  isSelfOrDescendant,
  leafName,
  matchPrimPath,
  parentPath,
  primKinds,
  primSegments,
  promoteToKind,
  searchPrimTree,
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

  it('énumère les ancêtres, de la racine au parent', () => {
    expect(ancestorPaths('/World/Asset/Geo')).toEqual(['/World', '/World/Asset']);
    expect(ancestorPaths('/World')).toEqual([]);
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

describe('flattenTree / searchPrimTree', () => {
  const tree = buildPrimTree([
    prim('/root'),
    prim('/root/chairA'),
    prim('/root/chairA/seat'),
    prim('/root/table'),
    prim('/root/table/leg'),
    prim('/root/table/leg/screw'),
  ]);

  it('aplatit en pré-ordre (ordre d’affichage) — plage Maj+clic', () => {
    expect(flattenTree(tree)).toEqual([
      '/root',
      '/root/chairA',
      '/root/chairA/seat',
      '/root/table',
      '/root/table/leg',
      '/root/table/leg/screw',
    ]);
  });

  it('filtre en gardant les ancêtres des résultats, insensible à la casse', () => {
    expect(flattenTree(searchPrimTree(tree, 'seat').tree)).toEqual([
      '/root',
      '/root/chairA',
      '/root/chairA/seat',
    ]);
    expect(flattenTree(searchPrimTree(tree, 'CHAIR').tree)).toEqual(['/root', '/root/chairA']);
    expect(searchPrimTree(tree, 'introuvable').tree).toEqual([]);
    // Requête vide : arbre inchangé (même référence), et rien à déplier de force.
    const blank = searchPrimTree(tree, '  ');
    expect(blank.tree).toBe(tree);
    expect(blank.expand.size).toBe(0);
  });

  it('ne retient QUE le nom : chercher « table » ne ramène pas toute sa descendance', () => {
    // Le défaut corrigé : la comparaison portait sur le chemin complet, et `/root/table/leg`
    // comme `/root/table/leg/screw` contenaient « table ». Tout le sous-arbre remontait.
    expect(flattenTree(searchPrimTree(tree, 'table').tree)).toEqual(['/root', '/root/table']);
  });

  it('ne déplie que le chemin menant au résultat', () => {
    // `/root` mène à la correspondance et s'ouvre ; `/root/table`, qui EST la correspondance,
    // reste fermé — on n'a pas demandé sa descendance.
    expect([...searchPrimTree(tree, 'table').expand]).toEqual(['/root']);
    // Une correspondance profonde ouvre toute sa lignée, et elle seule.
    expect([...searchPrimTree(tree, 'screw').expand].sort()).toEqual([
      '/root',
      '/root/table',
      '/root/table/leg',
    ]);
  });

  it('accepte une intention de chemin explicite quand la requête porte une barre', () => {
    expect(flattenTree(searchPrimTree(tree, 'table/leg').tree)).toEqual([
      '/root',
      '/root/table',
      '/root/table/leg',
      '/root/table/leg/screw',
    ]);
  });
});

describe('initialExpansion', () => {
  it('ouvre les deux premiers niveaux, pas le troisième', () => {
    const tree = buildPrimTree([prim('/root'), prim('/root/table'), prim('/root/table/leg')]);
    expect([...initialExpansion(tree)].sort()).toEqual(['/root', '/root/table']);
  });

  it('tient un arbre vide', () => {
    expect(initialExpansion([]).size).toBe(0);
  });
});

describe('promoteToKind — le clic désigne le component, pas la feuille', () => {
  /** Une chaise de scène de production : le component porte sa géométrie sous lui. */
  const KITCHEN = [
    prim('/Kitchen_set', { kind: 'assembly' }),
    prim('/Kitchen_set/Props_grp', { kind: 'group' }),
    prim('/Kitchen_set/Props_grp/ChairB_1', { kind: 'component' }),
    prim('/Kitchen_set/Props_grp/ChairB_1/Geom'),
    prim('/Kitchen_set/Props_grp/ChairB_1/Geom/seat'),
  ];
  const SEAT = '/Kitchen_set/Props_grp/ChairB_1/Geom/seat';
  const CHAIR = '/Kitchen_set/Props_grp/ChairB_1';
  const kinds = primKinds(KITCHEN);
  const selectable = new Set(KITCHEN.map((p) => p.path));

  it('remonte de la feuille touchée au component englobant', () => {
    expect(promoteToKind(SEAT, { kinds, selectable })).toBe(CHAIR);
  });

  it('rend le component lui-même quand c’est lui qu’on touche', () => {
    expect(promoteToKind(CHAIR, { kinds, selectable })).toBe(CHAIR);
  });

  it('ne promeut pas ce qui est au-dessus du component', () => {
    // Un groupe reste un groupe : la promotion ne monte jamais jusqu'à l'assembly.
    expect(promoteToKind('/Kitchen_set/Props_grp', { kinds, selectable })).toBe('/Kitchen_set/Props_grp');
  });

  it('garde le chemin quand l’ancêtre component manque à l’arbre (arbre tronqué)', () => {
    // `MAX_PRIMS_REPORTED` : l'analyseur n'a pas rapporté la chaise, seulement sa feuille.
    const truncated = primKinds([prim(SEAT)]);
    expect(promoteToKind(SEAT, { kinds: truncated })).toBe(SEAT);
  });

  it('traverse les prims implicites, au `kind` vide, sans s’y arrêter', () => {
    // `/Geom` est un niveau sans kind : il ne doit ni arrêter la remontée, ni être rendu à la
    // place du component.
    expect(promoteToKind('/Kitchen_set/Props_grp/ChairB_1/Geom', { kinds, selectable })).toBe(CHAIR);
  });

  it('ignore un component qui ne porte aucun objet manipulable', () => {
    // Sans objet indexé, le promouvoir donnerait une sélection sans halo, sans cadrage et sans
    // gizmo : mieux vaut garder la feuille, qui en a un.
    const withoutChair = new Set(selectable);
    withoutChair.delete(CHAIR);
    expect(promoteToKind(SEAT, { kinds, selectable: withoutChair })).toBe(SEAT);
  });

  it('sans liste de chemins manipulables, ne filtre rien', () => {
    expect(promoteToKind(SEAT, { kinds })).toBe(CHAIR);
  });

  it('rend null pour un chemin nul — un clic qui ne résout rien reste un clic dans le vide', () => {
    expect(promoteToKind(null, { kinds, selectable })).toBeNull();
  });

  it('vise le `kind` demandé, pas seulement `component`', () => {
    expect(promoteToKind(SEAT, { kinds, kind: 'assembly' })).toBe('/Kitchen_set');
  });
});
