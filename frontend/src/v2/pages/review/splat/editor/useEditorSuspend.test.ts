// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEditorSuspend } from './useEditorSuspend';
import type { VolumeRuntime } from './volumes/cropVolume';
import type { SplatViewer } from '../useSplat';
import type { SplatTransform } from '../../reviewTypes';

/**
 * Lire la proposition d'un commentaire suspend l'éditeur, et la sortie le rend INTACT.
 *
 * C'est la condition posée au rejeu : sans elle, montrer une proposition à un gestionnaire
 * revenait à écrire dans la scène qu'il est en train d'éditer. Le test vérifie les deux sens —
 * ce qui quitte la scène, et ce qui y revient, y compris quand l'auteur a continué d'éditer
 * pendant qu'il lisait.
 */
const trs = (x: number): SplatTransform => ({
  position: [x, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

function harness() {
  const mesh = { add: vi.fn() };
  const runtime = { edit: { removeFromParent: vi.fn() } } as unknown as VolumeRuntime;
  const splat = {
    ready: true,
    applyTransform: vi.fn(),
    setBaseFlip: vi.fn(),
    getSceneHandle: () => ({ mesh }) as never,
  } as unknown as SplatViewer;
  const runtimesRef = { current: new Map([[1, runtime]]) };
  return { mesh, runtime, splat, runtimesRef };
}

describe('useEditorSuspend — l’éditeur rend la main, puis la reprend', () => {
  it('ne touche à rien tant qu’aucune proposition n’est lue', () => {
    const h = harness();
    renderHook(() =>
      useEditorSuspend({
        enabled: true,
        suspended: false,
        splat: h.splat,
        runtimesRef: h.runtimesRef,
        transform: trs(2),
        baseFlip: false,
      }),
    );
    expect(h.runtime.edit.removeFromParent).not.toHaveBeenCalled();
    expect(h.splat.applyTransform).not.toHaveBeenCalled();
  });

  it('retire les volumes locaux de la scène pendant la lecture', () => {
    const h = harness();
    renderHook(() =>
      useEditorSuspend({
        enabled: true,
        suspended: true,
        splat: h.splat,
        runtimesRef: h.runtimesRef,
        transform: trs(2),
        baseFlip: false,
      }),
    );
    expect(h.runtime.edit.removeFromParent).toHaveBeenCalledTimes(1);
    expect(h.mesh.add).not.toHaveBeenCalled();
    // Suspendre ne réécrit rien : c'est le rejeu de la proposition qui pilote le nuage.
    expect(h.splat.applyTransform).not.toHaveBeenCalled();
  });

  it('à la sortie, rend les volumes ET la transformation locale à l’identique', () => {
    const h = harness();
    const local = trs(2);
    const { rerender } = renderHook(
      ({ suspended }: { suspended: boolean }) =>
        useEditorSuspend({
          enabled: true,
          suspended,
          splat: h.splat,
          runtimesRef: h.runtimesRef,
          transform: local,
          baseFlip: false,
        }),
      { initialProps: { suspended: true } },
    );
    rerender({ suspended: false });
    expect(h.mesh.add).toHaveBeenCalledWith(h.runtime.edit);
    expect(h.splat.applyTransform).toHaveBeenCalledWith(local);
    expect(h.splat.setBaseFlip).toHaveBeenCalledWith(false);
  });

  /**
   * L'édition peut continuer pendant la lecture (le gizmo reste sous la main) : ce qu'on rend à
   * la sortie est l'état du DERNIER rendu, pas celui d'avant la lecture.
   */
  it('rend l’état le plus récent, pas celui figé à l’entrée en lecture', () => {
    const h = harness();
    const { rerender } = renderHook(
      ({ suspended, transform }: { suspended: boolean; transform: SplatTransform }) =>
        useEditorSuspend({
          enabled: true,
          suspended,
          splat: h.splat,
          runtimesRef: h.runtimesRef,
          transform,
          baseFlip: true,
        }),
      { initialProps: { suspended: true, transform: trs(2) } },
    );
    rerender({ suspended: true, transform: trs(5) });
    rerender({ suspended: false, transform: trs(5) });
    expect(h.splat.applyTransform).toHaveBeenLastCalledWith(trs(5));
  });

  it('hors éditeur, il n’y a rien à suspendre', () => {
    const h = harness();
    renderHook(() =>
      useEditorSuspend({
        enabled: false,
        suspended: true,
        splat: h.splat,
        runtimesRef: h.runtimesRef,
        transform: trs(2),
        baseFlip: true,
      }),
    );
    expect(h.runtime.edit.removeFromParent).not.toHaveBeenCalled();
  });
});
