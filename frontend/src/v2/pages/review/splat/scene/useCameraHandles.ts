// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SparkRenderer } from '@sparkjsdev/spark';
import type { SplatCamera } from '../../reviewTypes';
import { captureSplatCamera, restoreSplatCamera } from './splatCameraState';
import { applyPoseToCamera } from '../../three/applyPose';

/** Minimum de scène requis pour capturer/restaurer une pose caméra (viewer libre + PiP layout). */
interface CameraScene {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  spark: SparkRenderer;
  layoutCam: THREE.PerspectiveCamera;
}

/**
 * Handles impératifs de pose caméra du viewer splat, extraits de `useSplat` (budget de taille) :
 * capture/restauration de la vue libre (avec DoF Spark) et restauration de la caméra layout du
 * PiP (Phase 27). Ne dépendent que des refs scène/Three — no-op tant que la scène n'est pas prête.
 */
export function useCameraHandles<S extends CameraScene>(
  sceneRef: RefObject<S | null>,
  threeRef: RefObject<typeof import('three') | null>,
) {
  const captureCamera = useCallback((): SplatCamera | undefined => {
    const s = sceneRef.current;
    const THREE = threeRef.current;
    if (!s || !THREE) return undefined;
    const cam = captureSplatCamera(THREE, s.camera, s.controls);
    // DoF Spark toujours inclus (0 = net partout) : répliqué en session live et restauré avec les commentaires.
    cam.apertureAngle = s.spark.apertureAngle;
    cam.focalDistance = s.spark.focalDistance;
    return cam;
  }, [sceneRef, threeRef]);

  const restoreCamera = useCallback(
    (state: unknown) => {
      const s = sceneRef.current;
      const THREE = threeRef.current;
      if (!s || !THREE) return;
      restoreSplatCamera(THREE, s.camera, s.controls, state);
      const dof = state as { apertureAngle?: number; focalDistance?: number } | null;
      if (typeof dof?.apertureAngle === 'number') s.spark.apertureAngle = dof.apertureAngle;
      if (typeof dof?.focalDistance === 'number') s.spark.focalDistance = dof.focalDistance;
    },
    [sceneRef, threeRef],
  );

  const restorePipCamera = useCallback(
    (state: unknown) => {
      const s = sceneRef.current;
      const THREE = threeRef.current;
      if (s && THREE) applyPoseToCamera(THREE, s.layoutCam, state as SplatCamera);
    },
    [sceneRef, threeRef],
  );

  return { captureCamera, restoreCamera, restorePipCamera };
}
