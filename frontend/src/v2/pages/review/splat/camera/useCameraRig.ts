// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SplatPresentation } from '../../reviewTypes';
import { applyRoll } from '../../three/cameraRoll';
import type { SplatViewer } from '../useSplat';
import { normalizeAnim } from '../../camera/channels/model';
import type { CameraAnimState } from '../../camera/useCameraAnim';
import { useT } from '../../../../i18n';

/**
 * Réglages caméra du viewer splat (10.G-V5) : focale (fov), profondeur de champ Spark
 * (`focalDistance` + `apertureAngle`), mise au point par clic-raycast, et **rejeu de la
 * présentation persistée à l'ouverture** (pose + DoF + animation, pour tous les spectateurs).
 * Les réglages en session sont locaux (non persistés) — seul le gestionnaire enregistre.
 */
export function useCameraRig(
  splat: SplatViewer,
  presentation: SplatPresentation | null,
  anim: Pick<CameraAnimState, 'setAnim' | 'play'>,
) {
  const t = useT();
  const { getSceneHandle, restoreCamera, ready } = splat;
  // États initialisés depuis la présentation persistée (le bloc splat remonte par média) —
  // le rejeu en effet n'applique qu'à la scène, sans setState (règle set-state-in-effect).
  const [fov, setFovState] = useState(() => presentation?.camera?.fov ?? 60);
  const [aperture, setApertureState] = useState(() => presentation?.dof?.apertureAngle ?? 0);
  const [roll, setRollState] = useState(() => presentation?.camera?.roll ?? 0);
  const [focusPick, setFocusPick] = useState(false);
  const appliedRef = useRef(false);

  const setFov = useCallback(
    (value: number) => {
      setFovState(value);
      const h = getSceneHandle();
      if (!h) return;
      h.camera.fov = value;
      h.camera.updateProjectionMatrix();
    },
    [getSceneHandle],
  );

  /** Ouverture du DoF (radians, 0 = net partout) ; la distance focale suit la cible d'orbite si non réglée. */
  const setAperture = useCallback(
    (angle: number) => {
      setApertureState(angle);
      const h = getSceneHandle();
      if (!h) return;
      if (angle > 0 && !(h.spark.focalDistance > 0))
        h.spark.focalDistance = h.camera.position.distanceTo(h.controls.target);
      h.spark.apertureAngle = angle;
    },
    [getSceneHandle],
  );

  /** Tilt (roll) de la caméra, en radians — oriente `camera.up` selon la direction de vue (layout). */
  const setRoll = useCallback(
    (value: number) => {
      setRollState(value);
      const h = getSceneHandle();
      if (!h) return;
      const forward = new h.THREE.Vector3().subVectors(h.controls.target, h.camera.position);
      applyRoll(h.THREE, h.camera, forward, value);
      h.controls.update();
    },
    [getSceneHandle],
  );

  /** Distance focale courante du renderer (persistance). */
  const focalDistance = useCallback(() => getSceneHandle()?.spark.focalDistance ?? 0, [getSceneHandle]);

  // Rejeu de la présentation persistée à l'ouverture (une fois le viewer prêt) — pour tous.
  const { setAnim, play } = anim;
  useEffect(() => {
    if (!ready || appliedRef.current) return;
    appliedRef.current = true;
    const h = getSceneHandle();
    if (presentation?.camera) restoreCamera(presentation.camera);
    if (presentation?.dof && h) {
      h.spark.focalDistance = presentation.dof.focalDistance;
      h.spark.apertureAngle = presentation.dof.apertureAngle;
    }
    const anim2 = normalizeAnim(presentation?.cameraAnim);
    if (anim2) {
      setAnim(anim2);
      play();
    }
  }, [ready, presentation, getSceneHandle, restoreCamera, setAnim, play]);

  // Mise au point au clic : le prochain clic gauche sur le canvas règle la distance focale.
  useEffect(() => {
    if (!focusPick) return;
    const h = getSceneHandle();
    if (!h) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const rect = h.dom.getBoundingClientRect();
      const ndc = new h.THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new h.THREE.Raycaster();
      raycaster.setFromCamera(ndc, h.camera);
      const hits: {
        distance: number;
        point: import('three').Vector3;
        object: import('three').Object3D;
      }[] = [];
      h.mesh.raycast(raycaster, hits);
      if (hits.length === 0) return;
      hits.sort((a, b) => a.distance - b.distance);
      const view = hits[0].point.clone().applyMatrix4(h.camera.matrixWorldInverse);
      h.spark.focalDistance = -view.z;
      setFocusPick(false);
      toast.success(t('splat.focusSet'));
    };
    h.dom.addEventListener('pointerdown', onDown);
    return () => h.dom.removeEventListener('pointerdown', onDown);
  }, [focusPick, getSceneHandle, t]);

  const toggleFocusPick = useCallback(() => setFocusPick((v) => !v), []);

  return { fov, setFov, aperture, setAperture, roll, setRoll, focalDistance, focusPick, toggleFocusPick };
}

export type CameraRigState = ReturnType<typeof useCameraRig>;
