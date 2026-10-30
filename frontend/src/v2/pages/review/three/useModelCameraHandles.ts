// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, useState, type RefObject } from 'react';
import { applyRoll } from './cameraRoll';
import { captureModelCamera, restoreModelCamera } from './modelCamera';
import { readViewState, sameViewState, type ReviewViewState } from './viewState';
import type { SceneRuntime } from './useModel3DThree';

/**
 * View-state provider (display mode, section plane, HDRI) registered by the review:
 * `captureCamera` aggregates it into the view attached to the comment, `restoreCamera` replays it.
 */
export interface ViewStateProvider {
  capture(): ReviewViewState;
  apply(state: ReviewViewState): void;
}

/**
 * Camera handles of the 3D viewer: view capture/restore (`Comment.cameraState`, live session,
 * bookmarks), focal length and tilt. Extracted from `useModel3DThree` (line budget).
 *
 * The captured view now carries the **view state** — without it, a comment written in wireframe,
 * with the cut open or under another HDRI would replay with the right camera in front of a different
 * image. The field is optional: earlier comments carry none, and consumers that do not know it
 * (animation sampling, persisted bookmarks, whose server drops unknown fields) ignore it.
 */
export function useModelCameraHandles(params: {
  runtimeRef: RefObject<SceneRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
}) {
  const { runtimeRef, threeRef } = params;
  const viewStateRef = useRef<ViewStateProvider | null>(null);
  const [fov, setFovState] = useState(45);
  const [roll, setRollState] = useState(0);

  const captureCamera = useCallback(() => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return undefined;
    const view = viewStateRef.current?.capture();
    const camera = captureModelCamera(THREE, rt.scene.camera, rt.scene.controls);
    return view ? { ...camera, view } : camera;
  }, [runtimeRef, threeRef]);

  const restoreCamera = useCallback(
    (state: unknown) => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return;
      restoreModelCamera(THREE, rt.scene.camera, rt.scene.controls, state);
      // The view state is only applied if it differs from **what is on screen**: the live session
      // replays the host's camera several times per second, and reapplying the HDRI on each packet
      // would reload it in a loop. Comparing against the current state rather than the last applied
      // one is what allows re-selecting a comment after changing the display mode by hand: its view
      // is then replayed.
      const view = readViewState(state);
      if (!view) return;
      const provider = viewStateRef.current;
      if (!provider || sameViewState(view, provider.capture())) return;
      provider.apply(view);
    },
    [runtimeRef, threeRef],
  );

  /** Registers (or removes) the view-state provider — called once by the review. */
  const registerViewState = useCallback((provider: ViewStateProvider | null) => {
    viewStateRef.current = provider;
  }, []);

  /** Focal length (fov) — live (main camera). */
  const setFov = useCallback(
    (value: number) => {
      setFovState(value);
      const rt = runtimeRef.current;
      if (!rt) return;
      rt.scene.camera.fov = value;
      rt.scene.camera.updateProjectionMatrix();
    },
    [runtimeRef],
  );

  /** Tilt (roll) — orients `camera.up` according to the view direction (layout mode). */
  const setRoll = useCallback(
    (value: number) => {
      setRollState(value);
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return;
      const forward = new THREE.Vector3().subVectors(rt.scene.controls.target, rt.scene.camera.position);
      applyRoll(THREE, rt.scene.camera, forward, value);
      rt.scene.controls.update();
    },
    [runtimeRef, threeRef],
  );

  return { captureCamera, restoreCamera, registerViewState, fov, setFov, roll, setRoll };
}
