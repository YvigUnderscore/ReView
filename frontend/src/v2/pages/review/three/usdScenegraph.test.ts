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
import type { UsdPrim } from '@/v2/types/api';

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

/** Paths of all nodes, depth-first — compact view of the tree for assertions. */
const flatten = (nodes: PrimNode[]): string[] => nodes.flatMap((n) => [n.path, ...flatten(n.children)]);

describe('USD paths', () => {
  it('splits, climbs to the parent and names the leaf', () => {
    expect(primSegments('/World/Asset/Geo')).toEqual(['World', 'Asset', 'Geo']);
    expect(parentPath('/World/Asset/Geo')).toBe('/World/Asset');
    expect(parentPath('/World')).toBeNull();
    expect(leafName('/World/Asset/Geo')).toBe('Geo');
  });

  it('enumerates the ancestors, from the root to the parent', () => {
    expect(ancestorPaths('/World/Asset/Geo')).toEqual(['/World', '/World/Asset']);
    expect(ancestorPaths('/World')).toEqual([]);
  });

  it('recognizes a descendant without confusing neighboring prefixes', () => {
    expect(isSelfOrDescendant('/World/Asset', '/World/Asset')).toBe(true);
    expect(isSelfOrDescendant('/World/Asset/Geo', '/World/Asset')).toBe(true);
    // `/World/AssetB` starts with `/World/Asset` without being one of its descendants.
    expect(isSelfOrDescendant('/World/AssetB', '/World/Asset')).toBe(false);
  });
});

describe('buildPrimTree', () => {
  it('rebuilds the hierarchy from the flat list', () => {
    const tree = buildPrimTree([prim('/World'), prim('/World/Asset'), prim('/World/Asset/Geo')]);
    expect(flatten(tree)).toEqual(['/World', '/World/Asset', '/World/Asset/Geo']);
    expect(tree[0].children[0].children[0].path).toBe('/World/Asset/Geo');
  });

  it('creates missing intermediate levels rather than orphaning the branch', () => {
    // Truncated tree: `/World/Asset` is missing between the root and the leaf.
    const tree = buildPrimTree([prim('/World'), prim('/World/Asset/Geo')]);
    expect(flatten(tree)).toEqual(['/World', '/World/Asset', '/World/Asset/Geo']);
    expect(tree[0].children[0].type).toBe(''); // implicit node, untyped
  });

  it('sorts siblings by name for a stable display', () => {
    const tree = buildPrimTree([prim('/W/b'), prim('/W/a'), prim('/W')]);
    expect(tree[0].children.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('keeps the metadata of the real prim despite a preceding implicit node', () => {
    const tree = buildPrimTree([
      prim('/World/Asset/Geo'),
      prim('/World/Asset', { type: 'Xform', variantSets: ['modelingVariant'] }),
    ]);
    const asset = tree[0].children[0];
    expect(asset.path).toBe('/World/Asset');
    expect(asset.variantSets).toEqual(['modelingVariant']);
    expect(asset.children.map((c) => c.path)).toEqual(['/World/Asset/Geo']);
  });

  it('returns an empty tree with no prim', () => {
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

  it('prefers strict equality', () => {
    expect(matchPrimPath('/World/Asset', paths)).toBe('/World/Asset');
  });

  it('absorbs a level collapsed by the Blender importer', () => {
    // Real case: Blender produces `/World/Asset/Geo/Suzanne`, the USD carries one extra `Geo`.
    expect(matchPrimPath('/World/Asset/Geo/Suzanne', paths)).toBe('/World/Asset/Geo/Geo/Suzanne');
  });

  it('returns null when no prim carries this name', () => {
    expect(matchPrimPath('/World/Autre', paths)).toBeNull();
  });

  it('returns null rather than deciding an ambiguity', () => {
    // Two homonymous prims at the same depth, without a discriminating common prefix.
    expect(matchPrimPath('/X/Mesh', ['/A/Mesh', '/B/Mesh'])).toBeNull();
  });

  it('breaks the tie by the longest common prefix', () => {
    expect(matchPrimPath('/A/B/Mesh', ['/A/B/C/Mesh', '/Z/Mesh'])).toBe('/A/B/C/Mesh');
  });
});

describe('buildRenderedPrimTree', () => {
  it('adds implicit prims for the geometry the parser does not compose', () => {
    // The parser composes ONE option per variant set: the geometry of the `lo` option,
    // baked into the GLB (46.G), does not exist in its list. Without an implicit prim, it was
    // unselectable and isolation fell back to the nearest known parent.
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

  it('does not duplicate known prims and discards _materials artifacts', () => {
    const tree = buildRenderedPrimTree(
      [prim('/World'), prim('/World/Asset')],
      ['/World/Asset', '/World/Asset/_materials'],
    );
    expect(flatten(tree)).toEqual(['/World', '/World/Asset']);
  });

  it('with no rendered path, renders the parser tree as is', () => {
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

  it('flattens in pre-order (display order) — Shift+click range', () => {
    expect(flattenTree(tree)).toEqual([
      '/root',
      '/root/chairA',
      '/root/chairA/seat',
      '/root/table',
      '/root/table/leg',
      '/root/table/leg/screw',
    ]);
  });

  it('filters while keeping the ancestors of the results, case-insensitive', () => {
    expect(flattenTree(searchPrimTree(tree, 'seat').tree)).toEqual([
      '/root',
      '/root/chairA',
      '/root/chairA/seat',
    ]);
    expect(flattenTree(searchPrimTree(tree, 'CHAIR').tree)).toEqual(['/root', '/root/chairA']);
    expect(searchPrimTree(tree, 'introuvable').tree).toEqual([]);
    // Empty query: tree unchanged (same reference), and nothing to force open.
    const blank = searchPrimTree(tree, '  ');
    expect(blank.tree).toBe(tree);
    expect(blank.expand.size).toBe(0);
  });

  it('matches ONLY on the name: searching "table" does not bring back all its descendants', () => {
    // The fixed bug: the comparison covered the full path, so `/root/table/leg` and
    // `/root/table/leg/screw` both contained "table". The whole subtree came back.
    expect(flattenTree(searchPrimTree(tree, 'table').tree)).toEqual(['/root', '/root/table']);
  });

  it('only expands the path leading to the result', () => {
    // `/root` leads to the match and opens; `/root/table`, which IS the match,
    // stays closed — its descendants were not requested.
    expect([...searchPrimTree(tree, 'table').expand]).toEqual(['/root']);
    // A deep match opens its entire lineage, and only that.
    expect([...searchPrimTree(tree, 'screw').expand].sort()).toEqual([
      '/root',
      '/root/table',
      '/root/table/leg',
    ]);
  });

  it('accepts an explicit path intent when the query contains a slash', () => {
    expect(flattenTree(searchPrimTree(tree, 'table/leg').tree)).toEqual([
      '/root',
      '/root/table',
      '/root/table/leg',
      '/root/table/leg/screw',
    ]);
  });
});

describe('initialExpansion', () => {
  it('opens the first two levels, not the third', () => {
    const tree = buildPrimTree([prim('/root'), prim('/root/table'), prim('/root/table/leg')]);
    expect([...initialExpansion(tree)].sort()).toEqual(['/root', '/root/table']);
  });

  it('holds an empty tree', () => {
    expect(initialExpansion([]).size).toBe(0);
  });
});

describe('promoteToKind — the click designates the component, not the leaf', () => {
  /** A production scene chair: the component carries its geometry beneath it. */
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

  it('climbs from the hit leaf to the enclosing component', () => {
    expect(promoteToKind(SEAT, { kinds, selectable })).toBe(CHAIR);
  });

  it('returns the component itself when it is what is touched', () => {
    expect(promoteToKind(CHAIR, { kinds, selectable })).toBe(CHAIR);
  });

  it('does not promote what sits above the component', () => {
    // A group stays a group: promotion never climbs up to the assembly.
    expect(promoteToKind('/Kitchen_set/Props_grp', { kinds, selectable })).toBe('/Kitchen_set/Props_grp');
  });

  it('keeps the path when the component ancestor is missing from the tree (truncated tree)', () => {
    // `MAX_PRIMS_REPORTED`: the parser did not report the chair, only its leaf.
    const truncated = primKinds([prim(SEAT)]);
    expect(promoteToKind(SEAT, { kinds: truncated })).toBe(SEAT);
  });

  it('traverses implicit prims with an empty kind without stopping on them', () => {
    // `/Geom` is a level without a kind: it must neither stop the climb nor be returned in
    // place of the component.
    expect(promoteToKind('/Kitchen_set/Props_grp/ChairB_1/Geom', { kinds, selectable })).toBe(CHAIR);
  });

  it('ignores a component carrying no manipulable object', () => {
    // Without an indexed object, promoting it would yield a selection without halo, framing or
    // gizmo: better keep the leaf, which has one.
    const withoutChair = new Set(selectable);
    withoutChair.delete(CHAIR);
    expect(promoteToKind(SEAT, { kinds, selectable: withoutChair })).toBe(SEAT);
  });

  it('without a list of manipulable paths, filters nothing', () => {
    expect(promoteToKind(SEAT, { kinds })).toBe(CHAIR);
  });

  it('returns null for a null path — a click resolving nothing stays a click on empty space', () => {
    expect(promoteToKind(null, { kinds, selectable })).toBeNull();
  });

  it('targets the requested `kind`, not just `component`', () => {
    expect(promoteToKind(SEAT, { kinds, kind: 'assembly' })).toBe('/Kitchen_set');
  });
});
