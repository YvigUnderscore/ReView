// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useScenegraphView } from './useScenegraphView';
import { buildPrimTree, type PrimNode } from './usdScenegraph';
import type { UsdPrim } from '../../../types/api';

/**
 * La mémoire du scenegraph : recherche et dépliage.
 *
 * Ils vivaient dans le panneau, que le dock démonte dès qu'on change d'onglet — l'arbre
 * repartait replié, requête effacée, et il fallait retrouver son prim à la main. Ils vivent
 * donc avec la scène, et ne s'effacent qu'avec elle (changement de média).
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
  it('déplie les deux premiers niveaux tant que personne n’y touche', () => {
    const { result } = renderHook(() => useScenegraphView(TREE, 1));
    expect([...result.current.expanded].sort()).toEqual(['/World', '/World/Chair']);
    expect(result.current.query).toBe('');
  });

  it('suit l’arbre qui arrive après le premier rendu', () => {
    // L'indexation de la scène Three prend quelques frames : un état initialisé une fois pour
    // toutes serait resté vide, et l'arbre serait apparu entièrement replié.
    const { result, rerender } = renderHook(({ tree }) => useScenegraphView(tree, 1), {
      initialProps: { tree: [] as PrimNode[] },
    });
    expect(result.current.expanded.size).toBe(0);
    rerender({ tree: TREE });
    expect([...result.current.expanded].sort()).toEqual(['/World', '/World/Chair']);
  });

  it('plie et déplie un nœud, et fige alors le dépliage', () => {
    const { result, rerender } = renderHook(({ tree }) => useScenegraphView(tree, 1), {
      initialProps: { tree: TREE },
    });
    act(() => result.current.toggle('/World/Chair'));
    expect(result.current.expanded.has('/World/Chair')).toBe(false);
    // Un arbre reconstruit à l'identique (réindexation) ne réinstalle pas le défaut : ce que
    // l'utilisateur a plié reste plié.
    rerender({ tree: makeTree() });
    expect(result.current.expanded.has('/World/Chair')).toBe(false);
    act(() => result.current.toggle('/World/Chair'));
    expect(result.current.expanded.has('/World/Chair')).toBe(true);
  });

  it('déplie un lot de chemins d’un coup — révélation du prim sélectionné', () => {
    const { result } = renderHook(() => useScenegraphView(TREE, 1));
    act(() => result.current.expand(['/World/Chair/Geom', '/World/Chair/Geom/seat']));
    expect([...result.current.expanded].sort()).toEqual([
      '/World',
      '/World/Chair',
      '/World/Chair/Geom',
      '/World/Chair/Geom/seat',
    ]);
  });

  it('oublie tout en changeant de média, et rien avant', () => {
    const { result, rerender } = renderHook(({ id }) => useScenegraphView(TREE, id), {
      initialProps: { id: 1 },
    });
    act(() => {
      result.current.setQuery('seat');
      result.current.toggle('/World');
    });
    expect(result.current.query).toBe('seat');
    expect(result.current.expanded.has('/World')).toBe(false);

    // Un simple rendu de plus (la caméra bouge, le dock se rend) ne perd rien.
    rerender({ id: 1 });
    expect(result.current.query).toBe('seat');

    // Un autre asset de la version : la recherche et le dépliage appartenaient à la scène qu'on
    // quitte, comme l'isolement et la sélection (46.K).
    rerender({ id: 2 });
    expect(result.current.query).toBe('');
    expect([...result.current.expanded].sort()).toEqual(['/World', '/World/Chair']);
  });
});
