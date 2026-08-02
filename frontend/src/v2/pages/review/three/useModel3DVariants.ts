// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { applyVariant, readVariants } from './materialVariants';
import { collectEmbeddedCameras, type EmbeddedCameraView } from './embeddedCameras';
import { restoreModelCamera } from './modelCamera';
import type { Model3DThreeState } from './useModel3DThree';

/**
 * Variantes de matériaux + caméras embarquées du modèle 3D (Phase 40, 40.C). Lit le glTF exposé
 * par `useModel3DThree` via `getSceneHandle` (comme `useModel3DInspect`) : liste les variantes et
 * les caméras une fois le modèle chargé, bascule les matériaux, et adopte une caméra embarquée
 * comme point de vue (via `restoreModelCamera`, l'infra caméra commune). Local à la session.
 */
export function useModel3DVariants(model3d: Model3DThreeState) {
  const { ready, getSceneHandle } = model3d;
  const [current, setCurrent] = useState(-1);

  // Variantes + caméras dérivées du glTF une fois le modèle prêt (mémoïsé, comme la fiche 39.C).
  const { variants, cameras } = useMemo<{ variants: string[]; cameras: EmbeddedCameraView[] }>(() => {
    if (!ready) return { variants: [], cameras: [] };
    const h = getSceneHandle();
    if (!h?.gltf || !h.mesh) return { variants: [], cameras: [] };
    // Distance de cadrage de la cible = rayon englobant (repère cohérent avec l'auto-cadrage).
    const sphere = new h.THREE.Box3().setFromObject(h.mesh).getBoundingSphere(new h.THREE.Sphere());
    return {
      variants: readVariants(h.gltf),
      cameras: collectEmbeddedCameras(h.THREE, h.gltf.cameras ?? [], sphere.radius),
    };
  }, [ready, getSceneHandle]);

  const selectVariant = useCallback(
    (index: number) => {
      const h = getSceneHandle();
      if (!h?.gltf || !h.mesh) return;
      setCurrent(index);
      applyVariant(h.gltf, h.mesh, index).catch(() =>
        toast.error('Impossible d’appliquer la variante de matériaux'),
      );
    },
    [getSceneHandle],
  );

  const goToCamera = useCallback(
    (index: number) => {
      const h = getSceneHandle();
      const view = cameras[index];
      if (!h || !view) return;
      restoreModelCamera(h.THREE, h.camera, h.controls, view);
    },
    [getSceneHandle, cameras],
  );

  return { variants, cameras, current, selectVariant, goToCamera };
}

export type Model3DVariantsState = ReturnType<typeof useModel3DVariants>;
