// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCameraAnim, type CameraAnimState, type CameraController } from './useCameraAnim';
import { sampleAnimV2 } from './channels/hermite';
import { emptyAnim, poseToBase, upsertKey, type CameraAnimV2 } from './channels/model';
import type { SplatCamera } from '../reviewTypes';

/**
 * The POSE BASE, HOOK VIEW (Phase 50, batch 13).
 *
 * The keyframe player and the scene rig sampled the same animation with TWO bases: the hook
 * started from a pose at the world origin until some path had captured one, and the scene rig
 * from the layout mode's activation view. An animation built WITH THE GIZMO goes through none of
 * these paths: its target, unkeyed, jumped to the origin on the first scrub — "if I go to 5
 * seconds, the camera goes back to its original position".
 *
 * These cases mount the hook with the controller the layout mode lends it, and verify that the
 * base travels with the new animation, without changing anything for a legacy animation.
 */

/** The plan pose that `captureCamera` returns (the out-of-camera PiP one). */
const shot: SplatCamera = {
  position: { x: 9, y: 3, z: 4 },
  target: { x: 1, y: 0.5, z: -2 },
  fov: 50,
};

/** The fallback the scene rig lends on its side (activation view). */
const rigFallback = shot;

/**
 * Mounts the hook on the layout mode's controller, as close to the real one as possible: the
 * capture returns the **last applied pose** to the plan's camera (`useLayoutMode.captureShot`
 * reads it from `shotPoseRef`, which `applyShot` writes), otherwise the activation view. It is
 * this chaining that makes the gizmo gesture order tricky — it scrubs before writing, and the
 * scrub of an animation without a base applies the world origin, which the capture would then
 * return as the "current view".
 */
function harness() {
  const capture = { current: shot as SplatCamera | undefined };
  const restored: SplatCamera[] = [];
  const controller: CameraController = {
    subscribeFrame: () => () => {},
    restoreCamera: (state) => {
      restored.push(state as SplatCamera);
    },
    captureCamera: () => restored[restored.length - 1] ?? capture.current,
    getDom: () => null,
  };
  const { result } = renderHook(() => useCameraAnim(controller));
  return { result, capture, restored, last: () => restored[restored.length - 1] };
}

/** Replays a gizmo gesture: opening the gesture, then writing the position channels. */
function gizmoDrag(result: { current: CameraAnimState }) {
  act(() => result.current.beginStroke());
  act(() => result.current.strokeUpsertAt(0, { px: 0, py: 3, pz: 4 }));
  act(() => result.current.strokeUpsertAt(1_000, { px: 10, py: 3, pz: 4 }));
}

describe('useCameraAnim — base of a new animation', () => {
  it('a gizmo gesture adopts the current view as the base', () => {
    const { result } = harness();
    gizmoDrag(result);
    expect(result.current.anim.base).toEqual(poseToBase(shot));
    expect(result.current.hasAnimation).toBe(true);
  });

  it('the unkeyed target no longer jumps to the origin on scrub', () => {
    const { result, last } = harness();
    gizmoDrag(result);
    act(() => result.current.scrub(5_000));
    // The bug: the pose applied to the camera was looking at the world origin.
    expect(last().target).toEqual(shot.target);
  });

  it('playback and out-of-playback render the same pose', () => {
    const { result, last } = harness();
    gizmoDrag(result);
    act(() => result.current.scrub(500));
    // Outside playback, it is the scene rig that samples, with its own fallback.
    expect(last()).toEqual(sampleAnimV2(result.current.anim, 500, rigFallback));
    // And even with any fallback: the animation's base wins.
    expect(last()).toEqual(
      sampleAnimV2(result.current.anim, 500, {
        position: { x: -50, y: -50, z: -50 },
        target: { x: -50, y: -50, z: -50 },
      }),
    );
  });

  it('the gesture scrubs before writing: the base does not take the pose already applied', () => {
    const { result } = harness();
    // The real order of the scene rig: open the gesture, bring the playhead to the time where it
    // will write, then write. Scrubbing an still-empty animation applies the fallback — if the base
    // were only adopted at write time, it would take that pose instead of the plan's view.
    act(() => result.current.beginStroke());
    act(() => result.current.scrub(250));
    act(() => result.current.strokeUpsertAt(250, { px: 0, py: 3, pz: 4 }));
    expect(result.current.anim.base).toEqual(poseToBase(shot));
  });

  it('setting a key at the view also adopts the base', () => {
    const { result } = harness();
    act(() => result.current.insertKeyAtView(0));
    expect(result.current.anim.base).toEqual(poseToBase(shot));
  });

  it('a key set on a single channel also adopts the base', () => {
    const { result } = harness();
    act(() => result.current.addKey('px', 0, 1));
    expect(result.current.anim.base).toEqual(poseToBase(shot));
  });

  it('a focal key on an empty channel starts from the base, not from zero', () => {
    const { result, capture } = harness();
    // A key on the `px` channel alone: the animation adopts the base, and `fov` stays EMPTY.
    act(() => result.current.addKey('px', 0, 1));
    // The capture then stops carrying the focal length: the value can only come from the channel,
    // empty, hence from the base. The fallback was 0 — a camera with a 0° field of view.
    capture.current = { position: shot.position, target: shot.target };
    act(() => result.current.insertChannelKeyAtView('fov', 500));
    expect(result.current.anim.channels.fov?.keys[0]?.v).toBe(50);
  });

  it('without a capturable view, no base is invented', () => {
    const { result, capture } = harness();
    capture.current = undefined;
    gizmoDrag(result);
    expect(result.current.anim.base).toBeUndefined();
  });
});

describe('useCameraAnim — legacy animation', () => {
  /** An animation as it was recorded before the base: keys, no base. */
  const legacy = (): CameraAnimV2 =>
    upsertKey(upsertKey(emptyAnim(), 'px', 0, 0, 'linear'), 'px', 1_000, 10, 'linear');

  it('stays without a base, even after a gizmo gesture', () => {
    const { result } = harness();
    act(() => result.current.setAnim(legacy()));
    expect(result.current.anim.base).toBeUndefined();
    gizmoDrag(result);
    // Giving it one would change the replay of an already-recorded presentation: ruled out.
    expect(result.current.anim.base).toBeUndefined();
  });

  it('samples exactly the previous values', () => {
    const { result, last } = harness();
    act(() => result.current.setAnim(legacy()));
    act(() => result.current.scrub(500));
    // Hand-written values: keyed channel interpolated (0→10 linear), unkeyed channels taken from
    // the pose captured by `setAnim` — what the hook already did.
    expect(last()).toEqual({
      position: { x: 5, y: shot.position.y, z: shot.position.z },
      target: shot.target,
      fov: 50,
    });
  });
});
