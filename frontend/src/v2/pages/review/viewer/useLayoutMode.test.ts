// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLayoutMode } from './useLayoutMode';
import { isAutoKeySuspended, suspendAutoKey } from '../camera/autoKeyGate';
import type { SplatCamera } from '../reviewTypes';

/**
 * Le modèle « dans / hors caméra ». Ce qui est vérifié ici est exactement ce qui manquait : hors
 * caméra, `restoreCamera` visait la caméra du PiP mais `captureCamera` échantillonnait la caméra
 * libre — poser une clé ne prenait donc jamais les modifications faites à la caméra du plan.
 */

const pose = (x: number): SplatCamera => ({
  position: { x, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
});

/** Monte le hook avec une caméra principale simulée dont on suit la pose. */
function setup() {
  const free = { current: pose(1) };
  const main: SplatCamera[] = [];
  const layout: SplatCamera[] = [];
  const frameCbs = new Set<(dt: number) => void>();
  const opts = {
    subscribeFrame: (cb: (dt: number) => void) => {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    getDom: () => null,
    captureCamera: () => free.current,
    restoreMain: (s: unknown) => main.push(s as SplatCamera),
    restoreLayout: (s: unknown) => layout.push(s as SplatCamera),
  };
  const view = renderHook(() => useLayoutMode(opts));
  return { ...view, free, main, layout };
}

beforeEach(() => suspendAutoKey(false));

describe('useLayoutMode — dans la caméra', () => {
  it('le lecteur pilote la caméra principale, et une clé l’échantillonne', () => {
    const { result, main, layout, free } = setup();
    expect(result.current.layoutMode).toBe(false);
    act(() => result.current.layoutController.restoreCamera(pose(5)));
    expect(main.at(-1)).toEqual(pose(5));
    expect(layout).toHaveLength(0);
    free.current = pose(7);
    expect(result.current.layoutController.captureCamera()).toEqual(pose(7));
  });

  it('laisse l’auto-key faire son travail', () => {
    setup();
    expect(isAutoKeySuspended()).toBe(false);
  });
});

describe('useLayoutMode — hors caméra', () => {
  it('pose la caméra du plan sur la vue courante en entrant', () => {
    const { result, free, layout } = setup();
    free.current = pose(3);
    act(() => result.current.setLayoutMode(true));
    expect(result.current.layoutMode).toBe(true);
    expect(layout.at(-1)).toEqual(pose(3));
  });

  it('échantillonne la caméra du PLAN, pas la caméra libre (le défaut)', () => {
    const { result, free } = setup();
    act(() => result.current.setLayoutMode(true));
    // La caméra libre s'en va explorer le plateau : elle ne décrit plus le plan.
    free.current = pose(99);
    expect(result.current.layoutController.captureCamera()).toEqual(pose(1));
  });

  it('suit ce que le rig applique — le gizmo bouge, la clé suivante en tient compte', () => {
    const { result, layout } = setup();
    act(() => result.current.setLayoutMode(true));
    act(() => result.current.applyShot(pose(42)));
    expect(layout.at(-1)).toEqual(pose(42));
    expect(result.current.layoutController.captureCamera()).toEqual(pose(42));
  });

  it('route le lecteur vers la caméra du PiP, jamais vers la principale', () => {
    const { result, main, layout } = setup();
    act(() => result.current.setLayoutMode(true));
    const before = main.length;
    act(() => result.current.layoutController.restoreCamera(pose(8)));
    expect(layout.at(-1)).toEqual(pose(8));
    expect(main).toHaveLength(before);
  });

  it('suspend l’auto-key, et le rétablit en rentrant dans la caméra', () => {
    const { result } = setup();
    act(() => result.current.setLayoutMode(true));
    expect(isAutoKeySuspended()).toBe(true);
    act(() => result.current.setLayoutMode(false));
    expect(isAutoKeySuspended()).toBe(false);
  });

  it('retente la capture sur les premières frames quand la scène n’est pas prête', () => {
    const free = { current: undefined as SplatCamera | undefined };
    const layout: SplatCamera[] = [];
    const frameCbs = new Set<(dt: number) => void>();
    const opts = {
      subscribeFrame: (cb: (dt: number) => void) => {
        frameCbs.add(cb);
        return () => frameCbs.delete(cb);
      },
      getDom: () => null,
      captureCamera: () => free.current,
      restoreMain: () => undefined,
      restoreLayout: (s: unknown) => layout.push(s as SplatCamera),
    };
    const { result } = renderHook(() => useLayoutMode(opts));
    act(() => result.current.setLayoutMode(true));
    expect(result.current.getActivationView()).toBeNull();
    act(() => frameCbs.forEach((cb) => cb(0.016)));
    expect(result.current.getActivationView()).toBeNull();
    free.current = pose(4); // la scène finit par être prête
    act(() => frameCbs.forEach((cb) => cb(0.016)));
    expect(result.current.getActivationView()).toEqual(pose(4));
    expect(layout.at(-1)).toEqual(pose(4));
    // Une fois la vue tenue, plus rien ne tourne dans la boucle pour ça.
    expect(frameCbs.size).toBe(0);
  });
});

describe('useLayoutMode — sortie', () => {
  it('replace la caméra principale sur la pose du plan (elle restait où la vue libre traînait)', () => {
    const { result, main } = setup();
    act(() => result.current.setLayoutMode(true));
    act(() => result.current.applyShot(pose(12)));
    act(() => result.current.setLayoutMode(false));
    expect(main.at(-1)).toEqual(pose(12));
  });

  it('ignore une bascule vers l’état déjà en place', () => {
    const { result, main, layout } = setup();
    act(() => result.current.setLayoutMode(false));
    expect(main).toHaveLength(0);
    expect(layout).toHaveLength(0);
    act(() => result.current.setLayoutMode(true));
    const applied = layout.length;
    act(() => result.current.setLayoutMode(true));
    expect(layout).toHaveLength(applied);
  });
});

describe('useLayoutMode — identité du contrôleur', () => {
  it('ne recrée pas le contrôleur à chaque rendu (le lecteur se réabonnerait)', () => {
    const { result, rerender } = setup();
    const first = result.current.layoutController;
    rerender();
    expect(result.current.layoutController).toBe(first);
  });
});
