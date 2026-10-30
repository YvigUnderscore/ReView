// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SplatCamera } from '../reviewTypes';
import type { CameraController } from '../camera/useCameraAnim';
import { suspendAutoKey } from '../camera/autoKeyGate';

/**
 * THE "IN / OUT OF CAMERA" MODEL — source of truth. Shared by 3D and splat.
 *
 * There are **two cameras** in the scene and **one** animation. At any moment this hook decides
 * which of the two is "the plan camera" — the one the animation drives and the one sampled when
 * a key is set.
 *
 * - **IN the camera** (`layoutMode` off): the plan camera **is** the main camera, the one
 *   manipulated with the mouse. The keyframe player drives it, a key samples it: everything
 *   coincides, there is nothing to arbitrate.
 * - **OUT of the camera** (`layoutMode` on): the main camera becomes free — we look at the set
 *   from the outside. The plan camera is then the layout camera, rendered in the PiP, and it can
 *   no longer be manipulated with the mouse: it is adjusted with the camera object's gizmo, the
 *   curve editor, and the focal length/tilt of the panel. We see nothing there but what the
 *   animation says.
 *
 * WHO OWNS WHAT
 * - The **mode** is written by a single caller per viewer: the mode switch of the chrome
 *   (`state.mode === 'stage'`), which the Camera panel toggle also drives. `setLayoutMode` is
 *   therefore only called in one place; `layoutMode` is read everywhere (PiP, camera object,
 *   panel).
 * - The **plan pose** (`shotPoseRef`) is held here. It is written by *everything* that applies a
 *   pose to the layout camera, via `applyShot`: the player (playback/scrub, through
 *   `restoreCamera`) and, when not playing, the scene rig that samples the animation on every
 *   frame (`useCameraSceneRig`). This is what makes the PiP follow **every** edit — gizmo, K key,
 *   curve drag, tangent, paste, undo — and not just playback.
 * - The **capture** (`layoutController.captureCamera`) returns this pose when out of the camera,
 *   and the main camera when in the camera. `captureCamera` and `restoreCamera` finally target
 *   the same camera: setting a key out of the camera used to sample the free camera, never the
 *   PiP one.
 *
 * WHAT IS FORBIDDEN OUT OF THE CAMERA
 * - **Auto-key** is suspended (`camera/autoKeyGate`): orbiting the free camera does not describe
 *   the plan, and the `pointerup` of a gizmo drag overwrote the key the gizmo had just written.
 *   To state it plainly: out of the camera, **the mouse on the canvas does not touch the plan**.
 *   What writes it is the camera object's gizmo, the curve editor, the focal length and the
 *   panel tilt. Setting a key (`K`) samples the plan pose, not the free view — to frame a plan
 *   with the mouse, one goes back into the camera.
 *
 * WHAT THE ARTIST MUST SEE (lot 13 — the mode was worthless without this feedback)
 * - The **PiP is the image of the plan**: the rig's helper objects are removed from it during the
 *   render pass (`viewer/sceneHelpers`). They are rigid relative to the plan camera — wireframe
 *   frustum starting in front of the lens, target marker at the centre — and they used to draw a
 *   motionless picture there, which made the PiP look frozen while the plan was moving.
 * - The **camera object is drawn on top of the scene** (`sceneRig/cameraObject`): inside a splat
 *   cloud or behind the model, depth testing used to make it simply disappear.
 * - A gizmo gesture **moves the playhead** to the time it writes (`sceneRig/useCameraSceneRig`):
 *   the scene shows the playback time, so editing a key at another instant was not visible.
 *
 * ENTRY AND EXIT
 * - On entry, the current view is retained (`getActivationView`): the layout camera and the
 *   camera object are posed there as long as no key exists, otherwise an empty animation would
 *   sample the origin and there would be nothing to manipulate at first contact.
 * - On exit, the main camera is posed **on the plan pose**: we go back into the camera just
 *   adjusted, instead of staying where the free view had drifted.
 *
 * Deliberate differences between the two viewers: the second scissor pass of the PiP is gated by
 * the mode on the 3D side (`useModelLayout.renderPip`) and by the mere presence of the rectangle
 * on the splat side (the `PipFrame` window is only mounted in layout mode, and reports `null` on
 * unmount).
 */
export function useLayoutMode(opts: {
  subscribeFrame: CameraController['subscribeFrame'];
  getDom: CameraController['getDom'];
  /** Captures the **main** camera (never the plan camera — see `captureShot`). */
  captureCamera: CameraController['captureCamera'];
  /** Applies a pose to the main camera (in the camera). */
  restoreMain: (state: unknown) => void;
  /** Applies a pose to the PiP layout camera (out of the camera). */
  restoreLayout: (state: unknown) => void;
}) {
  const { subscribeFrame, getDom, captureCamera, restoreMain, restoreLayout } = opts;
  const [layoutMode, setLayoutModeState] = useState(false);
  const layoutModeRef = useRef(false);
  const activationViewRef = useRef<SplatCamera | null>(null);
  // Last pose applied to the plan camera: what the PiP shows, hence what a key samples. Stored
  // as is — no re-reading from the Three camera, which would lose the target distance (a bare
  // camera does not carry its aim point).
  const shotPoseRef = useRef<SplatCamera | null>(null);

  /** Applies a pose to the plan camera **and** retains it. The only write of the PiP. */
  const applyShot = useCallback(
    (pose: SplatCamera) => {
      shotPoseRef.current = pose;
      restoreLayout(pose);
    },
    [restoreLayout],
  );

  const setLayoutMode = useCallback(
    (on: boolean) => {
      if (layoutModeRef.current === on) return;
      setLayoutModeState(on);
      layoutModeRef.current = on;
      if (on) {
        // Entry: the plan camera starts from the current view (so the PiP starts consistent).
        const view = captureCamera();
        activationViewRef.current = view ?? null;
        if (view) applyShot(view);
        return;
      }
      // Exit: back into the camera, so onto its pose.
      const pose = shotPoseRef.current;
      if (pose) restoreMain(pose);
    },
    [captureCamera, applyShot, restoreMain],
  );

  // Entry before the scene is ready (chrome reopened in "Stage" mode): the view cannot be
  // captured yet, and the plan camera would stay at the origin. Retry on the first frames, then
  // unsubscribe from the loop.
  useEffect(() => {
    if (!layoutMode || activationViewRef.current) return;
    let off: (() => void) | undefined = subscribeFrame(() => {
      const view = captureCamera();
      if (!view) return;
      activationViewRef.current = view;
      applyShot(view);
      off?.();
      off = undefined;
    });
    return () => off?.();
  }, [layoutMode, subscribeFrame, captureCamera, applyShot]);

  // Auto-key does not follow canvas gestures out of the camera (see `camera/autoKeyGate`).
  useEffect(() => {
    suspendAutoKey(layoutMode);
    return () => suspendAutoKey(false);
  }, [layoutMode]);

  const restoreCamera = useCallback(
    (state: unknown) => {
      if (!layoutModeRef.current) {
        restoreMain(state);
        return;
      }
      applyShot(state as SplatCamera);
    },
    [applyShot, restoreMain],
  );

  /**
   * Captures the plan camera: the pose shown in the PiP when out of the camera, the main camera
   * when in the camera. This is what `useCameraAnim` samples when setting a key.
   */
  const captureShot = useCallback((): SplatCamera | undefined => {
    if (!layoutModeRef.current) return captureCamera();
    return shotPoseRef.current ?? activationViewRef.current ?? captureCamera();
  }, [captureCamera]);

  /** View captured on entering the mode — fallback pose for channels without keys. */
  const getActivationView = useCallback(() => activationViewRef.current, []);

  const layoutController = useMemo<CameraController>(
    () => ({ subscribeFrame, getDom, captureCamera: captureShot, restoreCamera }),
    [subscribeFrame, getDom, captureShot, restoreCamera],
  );

  return {
    layoutMode,
    layoutModeRef,
    setLayoutMode,
    layoutController,
    getActivationView,
    /** Writes the plan camera from the scene rig (when not playing) — see the model above. */
    applyShot,
  };
}

export type LayoutModeState = ReturnType<typeof useLayoutMode>;
