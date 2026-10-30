// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyDisplayMode,
  createDisplayResources,
  type DisplayMode,
  type DisplayResources,
} from './displayModes';
import { collectModelStats, type ModelStats } from './modelStats';
import { createSkeletonOverlay, hasSkinnedMesh } from './skeletonOverlay';
import type { Model3DThreeState } from './useModel3DThree';
import type * as THREE from 'three';

/**
 * Inspection of the 3D model (Phase 39, 39.C): display modes (shaded/wireframe/normals/matcap/UV)
 * applied as a **non-destructive** override on the scene, and tech sheet (geometry, materials, UV,
 * textures, glTF extensions) collected on opening. Consumes `useModel3DThree` via `getSceneHandle`
 * (like `useModel3DLighting`). Override resources are built lazily and freed on unmount.
 */
export function useModel3DInspect(model3d: Model3DThreeState) {
  const { ready, getSceneHandle, extensions } = model3d;
  const [mode, setModeState] = useState<DisplayMode>('shaded');
  const [showSkeleton, setShowSkeletonState] = useState(false);
  const resRef = useRef<DisplayResources | null>(null);
  const skelRef = useRef<THREE.SkeletonHelper | null>(null);

  // Tech sheet: collected once the model is loaded (read-only walk of the normalized root).
  // Memoized on `ready` — `setReady(true)` is only emitted after the runtime scene is assigned.
  const stats = useMemo<ModelStats | null>(() => {
    if (!ready) return null;
    const handle = getSceneHandle();
    return handle?.mesh ? collectModelStats(handle.mesh) : null;
  }, [ready, getSceneHandle]);

  // Presence of a rig (SkinnedMesh) → enables the skeleton debug toggle (40.B).
  const hasSkeleton = useMemo<boolean>(() => {
    if (!ready) return false;
    const handle = getSceneHandle();
    return handle?.mesh ? hasSkinnedMesh(handle.mesh) : false;
  }, [ready, getSceneHandle]);

  // Applies the current mode (and re-applies it when the model has just loaded).
  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle?.mesh) return;
    if (!resRef.current) resRef.current = createDisplayResources(handle.THREE);
    applyDisplayMode(handle.mesh, mode, resRef.current);
  }, [ready, getSceneHandle, mode]);

  // Skeleton overlay (40.B): added to / removed from the scene according to the toggle; it updates
  // itself in the render loop (it is part of the scene graph), so it follows the rig's animation.
  useEffect(() => {
    const handle = getSceneHandle();
    if (!ready || !handle?.mesh) return;
    if (showSkeleton && !skelRef.current) {
      const helper = createSkeletonOverlay(handle.THREE, handle.mesh);
      handle.scene.add(helper);
      skelRef.current = helper;
    } else if (!showSkeleton && skelRef.current) {
      skelRef.current.removeFromParent();
      skelRef.current.dispose();
      skelRef.current = null;
    }
  }, [ready, getSceneHandle, showSkeleton]);

  // Release of the override materials/textures and of the skeleton overlay on unmount.
  useEffect(
    () => () => {
      resRef.current?.dispose();
      resRef.current = null;
      skelRef.current?.removeFromParent();
      skelRef.current?.dispose();
      skelRef.current = null;
    },
    [],
  );

  const setMode = useCallback((m: DisplayMode) => setModeState(m), []);
  const setShowSkeleton = useCallback((v: boolean) => setShowSkeletonState(v), []);

  return { mode, setMode, stats, extensions, hasSkeleton, showSkeleton, setShowSkeleton };
}

export type Model3DInspectState = ReturnType<typeof useModel3DInspect>;
