// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import { usePoiMarkers, type PoiMarkers, type PoiSceneAccess } from '../poi/usePoiMarkers';
import { raycastModelPoint } from './objectHotspot';
import type { SceneRuntime } from './useModel3DThree';

/**
 * Points of interest of the 3D viewer: the adapter of the SHARED hook (`poi/usePoiMarkers`), the very
 * one the splat uses. It only states what really distinguishes the two viewers — the object carrying
 * the points (the model's group), the bounding radius, and the surface radius, which here queries
 * triangles.
 *
 * The refs are read **at call time**: the viewer remounts on every file change, and a handle captured
 * once and for all would target a vanished scene.
 */
export function useModelPoi(
  runtimeRef: RefObject<SceneRuntime | null>,
  threeRef: RefObject<typeof import('three') | null>,
): PoiMarkers {
  const access = useCallback((): PoiSceneAccess | null => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return null;
    return {
      three: THREE,
      camera: rt.scene.camera,
      controls: rt.scene.controls,
      object: rt.scene.root,
      dom: rt.scene.renderer.domElement,
      radius: rt.modelRadius,
      pick: (ndc) => raycastModelPoint(THREE, rt.scene.camera, rt.scene.root, ndc),
    };
  }, [runtimeRef, threeRef]);
  return usePoiMarkers(access);
}
