// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useScenegraphView } from './useScenegraphView';
import { buildPrimTree, type PrimNode } from './usdScenegraph';
import type { UsdPrim } from '@/v2/types/api';

/**
 * The scenegraph's memory: search and expansion.
 *
 * They lived in the panel, which the dock unmounts as soon as one changes tab — the tree restarted
 * collapsed, query cleared, and the prim had to be found again by hand. They now live with the scene,
 * and are only cleared with it (media change).
 */

const prim = (path: string): UsdPrim => ({
  path,
  name: path.split('/').filter(Boolean).at(-1) ?? '',
  type: 'Xform',
  kind: '',
  purpose: '',
  variantSets: [],
  active: true,
  instanceable: false,
});

const PATHS = ['/World', '/World/Chair', '/World/Chair/Geom', '/World/Chair/Geom/seat'];
const makeTree = () => buildPrimTree(PATHS.map(prim));
const TREE = makeTree();

describe('useScenegraphView', () => {
  it('expands the first two levels as long as nobody touches them', () => {
    const { result } = renderHook(() => useScenegraphView(TREE, 1));
    expect([...result.current.expanded].sort()).toEqual(['/World', '/World/Chair']);
    expect(result.current.query).toBe('');
  });

  it('follows the tree that arrives after the first render', () => {
    // Indexing the Three scene takes a few frames: a state initialized once and for all would have
    // stayed empty, and the tree would have appeared entirely collapsed.
    const { result, rerender } = renderHook(({ tree }) => useScenegraphView(tree, 1), {
      initialProps: { tree: [] as PrimNode[] },
    });
    expect(result.current.expanded.size).toBe(0);
    rerender({ tree: TREE });
    expect([...result.current.expanded].sort()).toEqual(['/World', '/World/Chair']);
  });

  it('collapses and expands a node, and then freezes the expansion', () => {
    const { result, rerender } = renderHook(({ tree }) => useScenegraphView(tree, 1), {
      initialProps: { tree: TREE },
    });
    act(() => result.current.toggle('/World/Chair'));
    expect(result.current.expanded.has('/World/Chair')).toBe(false);
    // A tree rebuilt identically (re-indexing) does not reinstall the default: what the user
    // collapsed stays collapsed.
    rerender({ tree: makeTree() });
    expect(result.current.expanded.has('/World/Chair')).toBe(false);
    act(() => result.current.toggle('/World/Chair'));
    expect(result.current.expanded.has('/World/Chair')).toBe(true);
  });

  it('expands a batch of paths at once — reveals the selected prim', () => {
    const { result } = renderHook(() => useScenegraphView(TREE, 1));
    act(() => result.current.expand(['/World/Chair/Geom', '/World/Chair/Geom/seat']));
    expect([...result.current.expanded].sort()).toEqual([
      '/World',
      '/World/Chair',
      '/World/Chair/Geom',
      '/World/Chair/Geom/seat',
    ]);
  });

  it('forgets everything when changing media, and nothing before', () => {
    const { result, rerender } = renderHook(({ id }) => useScenegraphView(TREE, id), {
      initialProps: { id: 1 },
    });
    act(() => {
      result.current.setQuery('seat');
      result.current.toggle('/World');
    });
    expect(result.current.query).toBe('seat');
    expect(result.current.expanded.has('/World')).toBe(false);

    // One more render (the camera moves, the dock renders) loses nothing.
    rerender({ id: 1 });
    expect(result.current.query).toBe('seat');

    // Another asset of the version: the search and the expansion belonged to the scene being left,
    // like isolation and selection (46.K).
    rerender({ id: 2 });
    expect(result.current.query).toBe('');
    expect([...result.current.expanded].sort()).toEqual(['/World', '/World/Chair']);
  });
});
