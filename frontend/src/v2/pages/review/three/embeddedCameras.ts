// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { ModelCameraState } from './modelCamera';

/** Point de vue dérivé d'une caméra embarquée du glTF (nommé) — compatible `restoreModelCamera`. */
export interface EmbeddedCameraView extends ModelCameraState {
  name: string;
}

/**
 * Adopte les caméras embarquées d'un glTF (`gltf.cameras`) comme **points de vue** (Phase 40, 40.C)
 * : position/cible/fov dans l'espace monde de la scène (la caméra étant un nœud du modèle, ses
 * coordonnées incluent la normalisation). La cible est placée devant la caméra à `distance` le long
 * de son axe de regard. Les caméras doivent être attachées à la scène (matrices monde à jour).
 */
export function collectEmbeddedCameras(
  three: typeof import('three'),
  cameras: readonly THREE.Camera[],
  distance: number,
): EmbeddedCameraView[] {
  const d = distance > 0 ? distance : 1;
  return cameras.map((cam, i) => {
    const pos = cam.getWorldPosition(new three.Vector3());
    const dir = cam.getWorldDirection(new three.Vector3());
    const target = pos.clone().add(dir.multiplyScalar(d));
    const persp = cam as THREE.PerspectiveCamera;
    return {
      name: cam.name || `Caméra ${i + 1}`,
      position: { x: pos.x, y: pos.y, z: pos.z },
      target: { x: target.x, y: target.y, z: target.z },
      fov: persp.isPerspectiveCamera ? persp.fov : undefined,
    };
  });
}
