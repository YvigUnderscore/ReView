// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEditorSuspend } from './useEditorSuspend';
import type { VolumeRuntime } from './volumes/cropVolume';
import type { SplatViewer } from '../useSplat';
import type { SplatTransform } from '../../reviewTypes';

/**
 * Reading a comment's proposal suspends the editor, and leaving it restores it INTACT.
 *
 * This is the condition set for the replay: without it, showing a proposal to a manager would
 * amount to writing into the scene they are editing. The test checks both directions: what leaves
 * the scene, and what comes back to it, including when the author kept editing while reading.
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

describe('useEditorSuspend — the editor yields, then takes control back', () => {
  it('touches nothing while no proposal is being read', () => {
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

  it('removes the local volumes from the scene during reading', () => {
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
    // Suspending rewrites nothing: the replay of the proposal is what drives the cloud.
    expect(h.splat.applyTransform).not.toHaveBeenCalled();
  });

  it('on exit, restores the volumes AND the local transform unchanged', () => {
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
   * Editing can continue during the reading (the gizmo stays under the hand): what is restored
   * on exit is the state of the LAST render, not the one from before the reading.
   */
  it('restores the most recent state, not the one frozen on entering reading', () => {
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

  it('outside the editor, there is nothing to suspend', () => {
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
