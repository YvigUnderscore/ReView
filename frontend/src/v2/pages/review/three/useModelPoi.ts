// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import { usePoiMarkers, type PoiMarkers, type PoiSceneAccess } from '../poi/usePoiMarkers';
import { raycastModelPoint } from './objectHotspot';
import type { SceneRuntime } from './useModel3DThree';

/**
 * Points d'intérêt du viewer 3D : l'adaptateur du hook PARTAGÉ (`poi/usePoiMarkers`), celui-là
 * même que le splat utilise. Il ne dit que ce qui distingue vraiment les deux viewers — l'objet
 * qui porte les points (le groupe du modèle), le rayon englobant, et le rayon de surface, qui
 * interroge ici des triangles.
 *
 * Les refs sont lues **au moment de l'appel** : le viewer remonte à chaque changement de fichier,
 * et une poignée capturée une fois pour toutes viserait une scène disparue.
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
