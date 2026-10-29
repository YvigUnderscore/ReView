// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatCamera } from '../../reviewTypes';
import { applyRoll, captureCameraView } from '../../three/cameraRoll';

/**
 * Capture and restoration of the splat's camera view (extracted from `useSplat`, budget 300):
 * position, target, fov and **tilt (roll)**. The roll is read and applied via `camera.up` (layout
 * mode). Pure and testable.
 */
export function captureSplatCamera(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): SplatCamera {
  // Actual pose (quaternion): also follows the rotation in progress during a fly (live, returns 33).
  // The roll is omitted if the horizon is level (backward compatibility of saved states).
  return captureCameraView(three, camera, controls);
}

export function restoreSplatCamera(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  state: unknown,
): void {
  if (!state || typeof state !== 'object') return;
  const c = state as Partial<SplatCamera>;
  if (c.position) camera.position.set(c.position.x, c.position.y, c.position.z);
  if (c.fov != null) {
    camera.fov = c.fov;
    camera.updateProjectionMatrix();
  }
  if (c.target) controls.target.set(c.target.x, c.target.y, c.target.z);
  // Tilt (roll): orients `camera.up` according to the current view direction (layout mode).
  const forward = new three.Vector3().subVectors(controls.target, camera.position);
  applyRoll(three, camera, forward, c.roll ?? 0);
  controls.update();
}
