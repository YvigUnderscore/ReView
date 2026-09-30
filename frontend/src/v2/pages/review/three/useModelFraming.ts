// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, type RefObject } from 'react';
import type * as THREE from 'three';
import { fitDistance } from './sceneConfig';
import { frameCameraToSphere, objectBoundingSphere, objectsBoundingSphere } from '../viewer/frameCamera';
import { useFrameShortcuts } from '../viewer/useFrameShortcuts';
import type { SceneRuntime } from './useModel3DThree';

/**
 * Cadrage F/H du viewer 3D (unifié avec le splat) — extrait de `useModel3DThree` (39.C, budget de
 * lignes) : `F` cadre la **sélection** (prim USD sélectionné, via `frameTargetRef`) ou le modèle
 * entier, en conservant la direction de vue ; `H` rétablit la vue d'origine (face au modèle,
 * cible au centre). Les raccourcis sont désactivés en vol.
 */
export function useModelFraming(params: {
  runtimeRef: RefObject<SceneRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  ready: boolean;
  isFlying: () => boolean;
}) {
  const { runtimeRef, threeRef, ready, isFlying } = params;

  // Cible de cadrage `F` (46.I) : fournisseur enregistré par la review (objets du prim USD
  // sélectionné) — vide ou absent = cadrer le modèle entier, comportement historique.
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
    // Le modèle est posé sur la grille (`y = 0`) : la cible est son centre, pas l'origine — c'est
    // aussi l'axe autour duquel le turntable fait orbiter la caméra.
    const { modelCenter } = rt;
    camera.position.set(modelCenter.x, modelCenter.y, modelCenter.z + dist);
    controls.target.copy(modelCenter);
    controls.update();
  }, [runtimeRef]);

  useFrameShortcuts({ active: ready, isFlying, onFrame: frameView, onHome: homeView });

  return { frameView, homeView, setFrameTarget };
}
