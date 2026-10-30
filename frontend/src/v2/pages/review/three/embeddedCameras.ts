// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { ModelCameraState } from './modelCamera';

/** Viewpoint derived from an embedded glTF camera (named): compatible with `restoreModelCamera`. */
export interface EmbeddedCameraView extends ModelCameraState {
  name: string;
}

/**
 * Adopts the embedded cameras of a glTF (`gltf.cameras`) as **viewpoints** (Phase 40, 40.C):
 * position, target and fov in the scene's world space (the camera being a node of the model, its
 * coordinates include the normalisation). The target is placed in front of the camera at `distance`
 * along its viewing axis. The cameras must be attached to the scene (world matrices up to date).
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
