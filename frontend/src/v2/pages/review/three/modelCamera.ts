// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyRoll, captureCameraView } from './cameraRoll';

/** Camera view of a Three model (free position/target), stored in `Comment.cameraState`. */
export interface ModelCameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
  aspect?: number;
  /** Tilt (roll) around the view axis, in radians (layout mode). */
  roll?: number;
}

/** Orbit inherited from model-viewer (azimuth/polar/radius), read back leniently. */
interface LegacyOrbit {
  orbit?: { theta: number; phi: number; radius: number };
  target?: { x: number; y: number; z: number };
  fov?: number;
}

/**
 * Converts a model-viewer orbit (theta around Y, phi from +Y, radius) into a Cartesian position
 * around `target`. Pure, testable — used to read back legacy 3D views.
 */
export function orbitToPosition(
  three: typeof import('three'),
  orbit: { theta: number; phi: number; radius: number },
  target: { x: number; y: number; z: number },
): THREE.Vector3 {
  const { theta, phi, radius } = orbit;
  return new three.Vector3(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta),
  );
}

export function captureModelCamera(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): ModelCameraState {
  // Real pose (quaternion): also follows the rotation in progress during a flight (live, feedback 33).
  return captureCameraView(three, camera, controls);
}

/**
 * Restores a camera view (V5). Lenient: position format (new Three viewer) or orbit
 * (legacy 3D comments from model-viewer). No-op if the state is unusable.
 */
export function restoreModelCamera(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  state: unknown,
): void {
  if (!state || typeof state !== 'object') return;
  const s = state as Partial<ModelCameraState> & LegacyOrbit;
  const target = s.target ?? { x: 0, y: 0, z: 0 };
  if (s.position) {
    camera.position.set(s.position.x, s.position.y, s.position.z);
  } else if (s.orbit) {
    camera.position.copy(orbitToPosition(three, s.orbit, target));
  } else {
    return;
  }
  controls.target.set(target.x, target.y, target.z);
  if (s.fov != null) {
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
  }
  // Tilt (roll): orients `camera.up` according to the view direction (layout mode).
  const forward = new three.Vector3().subVectors(controls.target, camera.position);
  applyRoll(three, camera, forward, s.roll ?? 0);
  controls.update();
}
