// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, type RefObject } from 'react';
import type * as THREE from 'three';
import { fitDistance } from './sceneConfig';
import { frameCameraToSphere, objectBoundingSphere, objectsBoundingSphere } from '../viewer/frameCamera';
import { useFrameShortcuts } from '../viewer/useFrameShortcuts';
import type { SceneRuntime } from './useModel3DThree';

/**
 * F/H framing of the 3D viewer (unified with the splat) — extracted from `useModel3DThree` (39.C,
 * line budget): `F` frames the **selection** (USD prim selected, via `frameTargetRef`) or the whole
 * model, keeping the view direction; `H` restores the original view (facing the model, target at
 * the center). Shortcuts are disabled during flight.
 */
export function useModelFraming(params: {
  runtimeRef: RefObject<SceneRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  ready: boolean;
  isFlying: () => boolean;
}) {
  const { runtimeRef, threeRef, ready, isFlying } = params;

  // `F` framing target (46.I): provider registered by the review (objects of the selected USD prim)
  // — empty or absent = frame the whole model, the historical behavior.
  const frameTargetRef = useRef<(() => THREE.Object3D[]) | null>(null);
  const setFrameTarget = useCallback((provider: (() => THREE.Object3D[]) | null) => {
    frameTargetRef.current = provider;
  }, []);

  const frameView = useCallback(() => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return;
    const targets = frameTargetRef.current?.() ?? [];
    const bounds =
      targets.length > 0 ? objectsBoundingSphere(THREE, targets) : objectBoundingSphere(THREE, rt.scene.root);
    if (bounds) frameCameraToSphere(rt.scene.camera, rt.scene.controls, bounds.center, bounds.radius);
  }, [runtimeRef, threeRef, frameTargetRef]);

  const homeView = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const { camera, controls } = rt.scene;
    const dist = fitDistance(rt.modelRadius, camera.fov, camera.aspect || 1);
    if (dist <= 0) return;
    // The model rests on the grid (`y = 0`): the target is its center, not the origin — it is also
    // the axis around which the turntable orbits the camera.
    const { modelCenter } = rt;
    camera.position.set(modelCenter.x, modelCenter.y, modelCenter.z + dist);
    controls.target.copy(modelCenter);
    controls.update();
  }, [runtimeRef]);

  useFrameShortcuts({ active: ready, isFlying, onFrame: frameView, onHome: homeView });

  return { frameView, homeView, setFrameTarget };
}
