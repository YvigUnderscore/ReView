// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, type RefObject } from 'react';
import type * as THREE from 'three';
import type { SplatCamera } from '../reviewTypes';
import type { CameraController } from '../camera/useCameraAnim';
import type { ModelScene } from './createModelScene';
import { applyPoseToCamera } from './applyPose';
import { restoreModelCamera } from './modelCamera';
import { useLayoutMode } from '../viewer/useLayoutMode';
import { renderPipPass, type PipRect } from '../viewer/pipWindow';

interface LayoutRuntime {
  scene: ModelScene;
  layoutCam: THREE.PerspectiveCamera;
}

/**
 * Layout mode of the 3D viewer: common core `viewer/useLayoutMode` + Three specifics — the layout
 * camera is a local object (`runtime.layoutCam`) and the PiP's second scissor pass is rendered here
 * (`renderPip`, called by the viewer's loop).
 */
export function useModelLayout(opts: {
  runtimeRef: RefObject<LayoutRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  subscribeFrame: CameraController['subscribeFrame'];
  getDom: CameraController['getDom'];
  captureCamera: CameraController['captureCamera'];
}) {
  const { runtimeRef, threeRef, subscribeFrame, getDom, captureCamera } = opts;
  // PiP window rect (CSS px, top-left origin) — tracked by the scissor pass (PipFrame).
  const pipRectRef = useRef<PipRect | null>(null);

  const restoreMain = useCallback(
    (state: unknown) => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (rt && THREE) restoreModelCamera(THREE, rt.scene.camera, rt.scene.controls, state);
    },
    [runtimeRef, threeRef],
  );

  const restoreLayout = useCallback(
    (state: unknown) => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (rt && THREE) applyPoseToCamera(THREE, rt.layoutCam, state as SplatCamera);
    },
    [runtimeRef, threeRef],
  );

  const core = useLayoutMode({ subscribeFrame, getDom, captureCamera, restoreMain, restoreLayout });
  const { layoutModeRef } = core;

  const setPipRect = useCallback((rect: PipRect | null) => {
    pipRectRef.current = rect;
  }, []);

  /** Second render pass: the PiP of the layout camera (called by the viewer's loop). */
  const renderPip = useCallback(() => {
    if (!layoutModeRef.current) return;
    const rt = runtimeRef.current;
    const rect = pipRectRef.current;
    if (!rt || !rect) return;
    const dom = rt.scene.renderer.domElement;
    // Depth follows the free camera: `F`, real size and loading another model re-set near/far on
    // the scene's scale, while the PiP camera kept the old ones.
    renderPipPass(
      rt.scene.renderer,
      rt.scene.scene,
      rt.layoutCam,
      rect,
      dom.clientWidth,
      dom.clientHeight,
      rt.scene.camera,
    );
  }, [runtimeRef, layoutModeRef]);

  return { ...core, renderPip, setPipRect };
}
