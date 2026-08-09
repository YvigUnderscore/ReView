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
 * Mode layout du viewer 3D : cœur commun `viewer/useLayoutMode` + spécificités Three — la caméra
 * layout est un objet local (`runtime.layoutCam`) et la 2ᵉ passe scissor du PiP est rendue ici
 * (`renderPip`, appelé par la boucle du viewer).
 */
export function useModelLayout(opts: {
  runtimeRef: RefObject<LayoutRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  subscribeFrame: CameraController['subscribeFrame'];
  getDom: CameraController['getDom'];
  captureCamera: CameraController['captureCamera'];
}) {
  const { runtimeRef, threeRef, subscribeFrame, getDom, captureCamera } = opts;
  // Rect de la fenêtre PiP (px CSS, origine haut-gauche) — suivi par la passe scissor (PipFrame).
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

  /** 2ᵉ passe de rendu : le PiP de la caméra layout (appelé par la boucle du viewer). */
  const renderPip = useCallback(() => {
    if (!layoutModeRef.current) return;
    const rt = runtimeRef.current;
    const rect = pipRectRef.current;
    if (!rt || !rect) return;
    const dom = rt.scene.renderer.domElement;
    renderPipPass(rt.scene.renderer, rt.scene.scene, rt.layoutCam, rect, dom.clientWidth, dom.clientHeight);
  }, [runtimeRef, layoutModeRef]);

  return { ...core, renderPip, setPipRect };
}
