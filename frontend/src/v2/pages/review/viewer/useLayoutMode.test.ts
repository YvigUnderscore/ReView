// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLayoutMode } from './useLayoutMode';
import { isAutoKeySuspended, suspendAutoKey } from '../camera/autoKeyGate';
import type { SplatCamera } from '../reviewTypes';

/**
 * The "in / out of camera" model. What is verified here is exactly what was missing: out of the
 * camera, `restoreCamera` targeted the PiP camera but `captureCamera` sampled the free camera —
 * so setting a key never picked up the changes made to the plan camera.
 */

const pose = (x: number): SplatCamera => ({
  position: { x, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
});

/** Mounts the hook with a simulated main camera whose pose is tracked. */
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

describe('useLayoutMode — in the camera', () => {
  it('the player drives the main camera, and a key samples it', () => {
    const { result, main, layout, free } = setup();
    expect(result.current.layoutMode).toBe(false);
    act(() => result.current.layoutController.restoreCamera(pose(5)));
    expect(main.at(-1)).toEqual(pose(5));
    expect(layout).toHaveLength(0);
    free.current = pose(7);
    expect(result.current.layoutController.captureCamera()).toEqual(pose(7));
  });

  it('lets auto-key do its work', () => {
    setup();
    expect(isAutoKeySuspended()).toBe(false);
  });
});

describe('useLayoutMode — out of the camera', () => {
  it('poses the plan camera on the current view when entering', () => {
    const { result, free, layout } = setup();
    free.current = pose(3);
    act(() => result.current.setLayoutMode(true));
    expect(result.current.layoutMode).toBe(true);
    expect(layout.at(-1)).toEqual(pose(3));
  });

  it('samples the PLAN camera, not the free camera (the former default)', () => {
    const { result, free } = setup();
    act(() => result.current.setLayoutMode(true));
    // The free camera goes off exploring the set: it no longer describes the plan.
    free.current = pose(99);
    expect(result.current.layoutController.captureCamera()).toEqual(pose(1));
  });

  it('follows what the rig applies — the gizmo moves, the next key takes it into account', () => {
    const { result, layout } = setup();
    act(() => result.current.setLayoutMode(true));
    act(() => result.current.applyShot(pose(42)));
    expect(layout.at(-1)).toEqual(pose(42));
    expect(result.current.layoutController.captureCamera()).toEqual(pose(42));
  });

  it('routes the player to the PiP camera, never to the main one', () => {
    const { result, main, layout } = setup();
    act(() => result.current.setLayoutMode(true));
    const before = main.length;
    act(() => result.current.layoutController.restoreCamera(pose(8)));
    expect(layout.at(-1)).toEqual(pose(8));
    expect(main).toHaveLength(before);
  });

  it('suspends auto-key, and restores it when going back into the camera', () => {
    const { result } = setup();
    act(() => result.current.setLayoutMode(true));
    expect(isAutoKeySuspended()).toBe(true);
    act(() => result.current.setLayoutMode(false));
    expect(isAutoKeySuspended()).toBe(false);
  });

  it('retries the capture on the first frames when the scene is not ready', () => {
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
    free.current = pose(4); // the scene eventually becomes ready
    act(() => frameCbs.forEach((cb) => cb(0.016)));
    expect(result.current.getActivationView()).toEqual(pose(4));
    expect(layout.at(-1)).toEqual(pose(4));
    // Once the view is held, nothing runs in the loop for this anymore.
    expect(frameCbs.size).toBe(0);
  });
});

describe('useLayoutMode — exit', () => {
  it('puts the main camera back on the plan pose (it used to stay where the free view had drifted)', () => {
    const { result, main } = setup();
    act(() => result.current.setLayoutMode(true));
    act(() => result.current.applyShot(pose(12)));
    act(() => result.current.setLayoutMode(false));
    expect(main.at(-1)).toEqual(pose(12));
  });

  it('ignores a toggle to the state already in place', () => {
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

describe('useLayoutMode — controller identity', () => {
  it('does not recreate the controller on every render (the player would resubscribe)', () => {
    const { result, rerender } = setup();
    const first = result.current.layoutController;
    rerender();
    expect(result.current.layoutController).toBe(first);
  });
});
