// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { applyVariant, readVariants } from './materialVariants';
import { collectEmbeddedCameras, type EmbeddedCameraView } from './embeddedCameras';
import { restoreModelCamera } from './modelCamera';
import type { Model3DThreeState } from './useModel3DThree';
import { useT } from '../../../i18n';

/**
 * Material variants + embedded cameras of the 3D model (Phase 40, 40.C). Reads the glTF exposed by
 * `useModel3DThree` via `getSceneHandle` (like `useModel3DInspect`): lists the variants and the
 * cameras once the model is loaded, switches the materials, and adopts an embedded camera as the
 * point of view (via `restoreModelCamera`, the common camera infrastructure). Local to the session.
 */
export function useModel3DVariants(model3d: Model3DThreeState) {
  const t = useT();
  const { ready, getSceneHandle } = model3d;
  const [current, setCurrent] = useState(-1);

  // Variants + cameras derived from the glTF once the model is ready (memoized, like the 39.C sheet).
  const { variants, cameras } = useMemo<{ variants: string[]; cameras: EmbeddedCameraView[] }>(() => {
    if (!ready) return { variants: [], cameras: [] };
    const h = getSceneHandle();
    if (!h?.gltf || !h.mesh) return { variants: [], cameras: [] };
    // Framing distance of the target = bounding radius (consistent with the auto-framing).
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
      applyVariant(h.gltf, h.mesh, index).catch(() => toast.error(t('model3d.variantFailed')));
    },
    [getSceneHandle, t],
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
