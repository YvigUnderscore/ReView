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
 * Inspection du modèle 3D (Phase 39, 39.C) : modes d'affichage (shaded/wireframe/normales/matcap/
 * UV) appliqués en override **non destructif** sur la scène, et fiche technique (géométrie,
 * matériaux, UV, textures, extensions glTF) collectée à l'ouverture. Consomme `useModel3DThree`
 * via `getSceneHandle` (comme `useModel3DLighting`). Les ressources d'override sont construites
 * paresseusement et libérées au démontage.
 */
export function useModel3DInspect(model3d: Model3DThreeState) {
  const { ready, getSceneHandle, extensions } = model3d;
  const [mode, setModeState] = useState<DisplayMode>('shaded');
  const [showSkeleton, setShowSkeletonState] = useState(false);
  const resRef = useRef<DisplayResources | null>(null);
  const skelRef = useRef<THREE.SkeletonHelper | null>(null);

  // Fiche technique : collectée une fois le modèle chargé (parcours lecture seule du root normalisé).
  // Mémoïsée sur `ready` — `setReady(true)` n'est émis qu'après l'affectation de la scène runtime.
  const stats = useMemo<ModelStats | null>(() => {
    if (!ready) return null;
    const handle = getSceneHandle();
    return handle?.mesh ? collectModelStats(handle.mesh) : null;
  }, [ready, getSceneHandle]);

  // Présence d'un rig (SkinnedMesh) → active le toggle debug squelette (40.B).
  const hasSkeleton = useMemo<boolean>(() => {
    if (!ready) return false;
    const handle = getSceneHandle();
    return handle?.mesh ? hasSkinnedMesh(handle.mesh) : false;
  }, [ready, getSceneHandle]);

  // Applique le mode courant (et le ré-applique quand le modèle vient d'être chargé).
  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle?.mesh) return;
    if (!resRef.current) resRef.current = createDisplayResources(handle.THREE);
    applyDisplayMode(handle.mesh, mode, resRef.current);
  }, [ready, getSceneHandle, mode]);

  // Overlay squelette (40.B) : ajouté/retiré de la scène selon le toggle ; se met à jour tout seul
  // dans la boucle de rendu (dans le graphe de scène) donc suit l'animation du rig.
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

  // Libération des matériaux/textures d'override + overlay squelette au démontage.
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
