import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatCamera } from '../../reviewTypes';
import { applyRoll, rollFromUp } from '../../three/cameraRoll';

/**
 * Capture/restauration de la vue caméra du splat (extrait de `useSplat`, budget 300) : position,
 * cible, fov et **tilt (roll)** — le roll est lu/appliqué via `camera.up` (mode layout). Pur/testable.
 */
export function captureSplatCamera(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): SplatCamera {
  const cam: SplatCamera = {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    fov: camera.fov,
    aspect: camera.aspect,
  };
  const forward = new three.Vector3().subVectors(controls.target, camera.position);
  const roll = rollFromUp(three, forward, camera.up);
  if (Math.abs(roll) > 1e-4) cam.roll = roll; // omis si horizon droit (rétro-compat)
  return cam;
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
