// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type * as THREE from 'three';
import type { SplatCamera } from '../reviewTypes';
import type { CameraController } from '../camera/useCameraAnim';
import type { ModelScene } from './createModelScene';
import { applyPoseToCamera } from './applyPose';
import { captureModelCamera, restoreModelCamera } from './modelCamera';
import { renderPipPass, type PipRect } from '../viewer/pipWindow';

interface LayoutRuntime {
  scene: ModelScene;
  layoutCam: THREE.PerspectiveCamera;
}

/**
 * Mode layout du viewer 3D (Phase 15/16) : « in/out camera » + fenêtre flottante (PiP).
 * - **OFF** : le lecteur keyframe pilote la caméra principale (on est « dans » la caméra).
 * - **ON**  : la caméra principale est libre (« hors » caméra), le lecteur pilote une caméra
 *   layout distincte, rendue dans un PiP (2ᵉ passe scissor) — on voit le point de vue de la
 *   caméra tout en la déplaçant. `layoutController` sert `useCameraKeyframes` (capture depuis la
 *   caméra libre, application sur la bonne caméra selon le mode).
 */
export function useModelLayout(opts: {
  runtimeRef: RefObject<LayoutRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  subscribeFrame: CameraController['subscribeFrame'];
  getDom: CameraController['getDom'];
  captureCamera: CameraController['captureCamera'];
}) {
  const { runtimeRef, threeRef, subscribeFrame, getDom, captureCamera } = opts;
  const [layoutMode, setLayoutModeState] = useState(false);
  const layoutModeRef = useRef(false);
  // Rect de la fenêtre PiP (px CSS, origine haut-gauche) — suivi par la passe scissor (PipFrame).
  const pipRectRef = useRef<PipRect | null>(null);

  const setPipRect = useCallback((rect: PipRect | null) => {
    pipRectRef.current = rect;
  }, []);

  const setLayoutMode = useCallback(
    (on: boolean) => {
      setLayoutModeState(on);
      layoutModeRef.current = on;
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      // À l'activation : la caméra layout part de la vue courante (le PiP démarre cohérent).
      if (on && rt && THREE) {
        applyPoseToCamera(THREE, rt.layoutCam, captureModelCamera(THREE, rt.scene.camera, rt.scene.controls));
      }
    },
    [runtimeRef, threeRef],
  );

  const restoreCamera = useCallback(
    (state: unknown) => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return;
      if (layoutModeRef.current) applyPoseToCamera(THREE, rt.layoutCam, state as SplatCamera);
      else restoreModelCamera(THREE, rt.scene.camera, rt.scene.controls, state);
    },
    [runtimeRef, threeRef],
  );

  const layoutController = useMemo<CameraController>(
    () => ({ subscribeFrame, getDom, captureCamera, restoreCamera }),
    [subscribeFrame, getDom, captureCamera, restoreCamera],
  );

  /** 2ᵉ passe de rendu : le PiP de la caméra layout (appelé par la boucle du viewer). */
  const renderPip = useCallback(() => {
    if (!layoutModeRef.current) return;
    const rt = runtimeRef.current;
    const rect = pipRectRef.current;
    if (!rt || !rect) return;
    const dom = rt.scene.renderer.domElement;
    renderPipPass(rt.scene.renderer, rt.scene.scene, rt.layoutCam, rect, dom.clientWidth, dom.clientHeight);
  }, [runtimeRef]);

  return { layoutMode, setLayoutMode, layoutController, renderPip, setPipRect };
}
