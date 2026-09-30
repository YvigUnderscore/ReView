// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { poseForScale } from './loadModel';
import type { SceneRuntime } from './useModel3DThree';

/**
 * Bascule « taille réelle » du viewer 3D.
 *
 * Le chargement ramène tout modèle à deux unités monde pour que le cadrage soit cohérent quel
 * que soit l'export — pratique pour présenter, faux pour inspecter : un prop de 20 cm et un
 * décor de 30 m y apparaissent identiques. Le facteur de normalisation est maintenant
 * **conservé** (`SceneRuntime.normScale`), donc la bascule ne recharge rien : elle re-pose le
 * wrapper à l'échelle 1 (unités du fichier) ou à l'échelle normalisée, met à jour le rayon et
 * le centre dont dépendent le cadrage et le turntable, puis recadre.
 *
 * `near`/`far` sont recalculés dans la foulée : à l'échelle réelle, un décor de 30 m sortirait
 * du frustum réglé pour un objet de 2 unités, et un objet de 2 cm disparaîtrait dans le near.
 *
 * Le réglage est une **préférence d'inspection** : elle survit au changement de média, et
 * `reapplyRef` la rejoue sur le modèle qui vient d'être chargé (sinon l'interrupteur
 * annoncerait une échelle réelle devant un modèle normalisé).
 */
export function useModelScale(params: {
  runtimeRef: RefObject<SceneRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
  homeView: () => void;
  /** Rempli par le hook : appelé par la boucle de chargement, une fois le runtime en place. */
  reapplyRef: RefObject<(() => void) | null>;
}) {
  const { runtimeRef, threeRef, homeView, reapplyRef } = params;
  const [realScale, setRealScaleState] = useState(false);
  const realScaleRef = useRef(false);

  /** Re-pose le wrapper à l'échelle demandée (aucun état React touché). */
  const pose = useCallback(
    (on: boolean, refit: boolean) => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return;
      const next = poseForScale(THREE, rt.modelBox, on ? 1 : rt.normScale);
      rt.modelObject.scale.setScalar(next.scale);
      rt.modelObject.position.copy(next.position);
      rt.modelRadius = next.radius;
      rt.modelCenter = next.center;
      const { camera } = rt.scene;
      camera.near = rt.layoutCam.near = Math.max(next.radius / 100, 0.000001);
      camera.far = rt.layoutCam.far = Math.max(next.radius * 100, 1);
      camera.updateProjectionMatrix();
      rt.layoutCam.updateProjectionMatrix();
      if (refit) homeView();
    },
    [runtimeRef, threeRef, homeView],
  );

  useEffect(() => {
    // Le modèle fraîchement chargé est normalisé : on lui applique la préférence en cours,
    // recadrage compris — le cadrage initial a été calculé sur le rayon normalisé.
    reapplyRef.current = () => realScaleRef.current && pose(true, true);
    return () => {
      reapplyRef.current = null;
    };
  }, [pose, reapplyRef]);

  const setRealScale = useCallback(
    (on: boolean) => {
      realScaleRef.current = on;
      setRealScaleState(on);
      pose(on, true);
    },
    [pose],
  );

  return { realScale, setRealScale };
}
