import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyRoll, captureCameraView } from './cameraRoll';

/** Vue caméra d'un modèle Three (position/cible libres) — stockée dans `Comment.cameraState`. */
export interface ModelCameraState {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
  aspect?: number;
  /** Tilt (roll) autour de l'axe de vue, en radians (mode layout). */
  roll?: number;
}

/** Orbite héritée de model-viewer (azimut/polaire/rayon) — relue de façon tolérante. */
interface LegacyOrbit {
  orbit?: { theta: number; phi: number; radius: number };
  target?: { x: number; y: number; z: number };
  fov?: number;
}

/**
 * Convertit une orbite model-viewer (theta autour de Y, phi depuis +Y, rayon) en position
 * cartésienne autour de `target`. Pure/testable — sert la relecture des vues 3D héritées.
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
  // Pose réelle (quaternion) : suit aussi la rotation en cours de vol (live, retours 33).
  return captureCameraView(three, camera, controls);
}

/**
 * Restaure une vue caméra (V5). Tolérant : format position (nouveau viewer Three) ou orbite
 * (comments 3D hérités de model-viewer). No-op si l'état est inexploitable.
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
  // Tilt (roll) : oriente `camera.up` selon la direction de vue (mode layout).
  const forward = new three.Vector3().subVectors(controls.target, camera.position);
  applyRoll(three, camera, forward, s.roll ?? 0);
  controls.update();
}
