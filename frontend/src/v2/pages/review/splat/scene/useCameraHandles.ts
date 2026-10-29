// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SparkRenderer } from '@sparkjsdev/spark';
import type { SplatCamera } from '../../reviewTypes';
import { captureSplatCamera, restoreSplatCamera } from './splatCameraState';
import { applyPoseToCamera } from '../../three/applyPose';

/** Minimum scene required to capture or restore a camera pose (free viewer and layout PiP). */
interface CameraScene {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  spark: SparkRenderer;
  layoutCam: THREE.PerspectiveCamera;
}

/**
 * Imperative camera-pose handles of the splat viewer, extracted from `useSplat` (size budget):
 * capture and restoration of the free view (with Spark DoF) and restoration of the layout camera
 * of the PiP (Phase 27). They only depend on the scene and Three refs: no-op until the scene is ready.
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
    // Spark DoF always included (0 = sharp everywhere): replicated in the live session and restored with the comments.
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
