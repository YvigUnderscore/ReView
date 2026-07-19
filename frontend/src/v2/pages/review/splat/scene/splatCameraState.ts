import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatCamera } from '../../reviewTypes';
import { applyRoll, captureCameraView } from '../../three/cameraRoll';

/**
 * Capture/restauration de la vue caméra du splat (extrait de `useSplat`, budget 300) : position,
 * cible, fov et **tilt (roll)** — le roll est lu/appliqué via `camera.up` (mode layout). Pur/testable.
 */
export function captureSplatCamera(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): SplatCamera {
  // Pose réelle (quaternion) : suit aussi la rotation en cours de vol (live, retours 33).
  // Le roll reste omis si l'horizon est droit (rétro-compat des états enregistrés).
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
  // Tilt (roll) : oriente `camera.up` selon la direction de vue courante (mode layout).
  const forward = new three.Vector3().subVectors(controls.target, camera.position);
  applyRoll(three, camera, forward, c.roll ?? 0);
  controls.update();
}
