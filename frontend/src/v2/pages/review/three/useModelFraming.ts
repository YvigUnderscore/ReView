import { useCallback, type RefObject } from 'react';
import { fitDistance } from './sceneConfig';
import { frameCameraToSphere, objectBoundingSphere } from '../viewer/frameCamera';
import { useFrameShortcuts } from '../viewer/useFrameShortcuts';
import type { SceneRuntime } from './useModel3DThree';

/**
 * Cadrage F/H du viewer 3D (unifié avec le splat) — extrait de `useModel3DThree` (39.C, budget de
 * lignes) : `F` cadre le modèle en conservant la direction de vue, `H` rétablit la vue d'origine
 * (face au modèle, cible au centre). Les raccourcis sont désactivés en vol.
 */
export function useModelFraming(params: {
  runtimeRef: RefObject<SceneRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  ready: boolean;
  isFlying: () => boolean;
}) {
  const { runtimeRef, threeRef, ready, isFlying } = params;

  const frameView = useCallback(() => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    if (!rt || !THREE) return;
    const bounds = objectBoundingSphere(THREE, rt.scene.root);
    if (bounds) frameCameraToSphere(rt.scene.camera, rt.scene.controls, bounds.center, bounds.radius);
  }, [runtimeRef, threeRef]);

  const homeView = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const { camera, controls } = rt.scene;
    const dist = fitDistance(rt.modelRadius, camera.fov, camera.aspect || 1);
    if (dist <= 0) return;
    camera.position.set(0, 0, dist);
    controls.target.set(0, 0, 0);
    controls.update();
  }, [runtimeRef]);

  useFrameShortcuts({ active: ready, isFlying, onFrame: frameView, onHome: homeView });

  return { frameView, homeView };
}
