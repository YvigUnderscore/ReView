// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatCamera } from '../reviewTypes';
import { applyRoll } from './cameraRoll';

/**
 * Applique une pose caméra (position/cible/fov/roll) à une caméra **sans OrbitControls** — la
 * caméra « layout » du mode PiP (Phase 15/16). Le roll oriente `camera.up`, puis `lookAt` cale
 * l'orientation vers la cible. Pur/testable.
 */
export function applyPoseToCamera(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  pose: SplatCamera,
): void {
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  if (pose.fov != null) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
  const target = new three.Vector3(pose.target.x, pose.target.y, pose.target.z);
  const forward = target.clone().sub(camera.position);
  applyRoll(three, camera, forward, pose.roll ?? 0);
  camera.lookAt(target);
}
