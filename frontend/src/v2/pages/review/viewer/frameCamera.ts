import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Cadre la caméra sur une sphère englobante en conservant la direction de vue courante
 * (raccourci `F` : cadrer la sélection ou l'objet sans réorienter). Ajuste near/far et la
 * cible OrbitControls. Renvoie `false` si la sphère est dégénérée. Commun 3D/splat (Phase 17,
 * extrait de `splat/scene/frameCamera`).
 */
export function frameCameraToSphere(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  center: THREE.Vector3,
  radius: number,
): boolean {
  if (!Number.isFinite(radius) || radius <= 0) return false;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
  const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.2;
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
  dir.normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(radius / 100, 0.001);
  camera.far = Math.max(camera.far, radius * 100);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  return true;
}

/** Sphère englobante monde d'un objet (bbox → sphère), ou null si dégénérée. */
export function objectBoundingSphere(
  three: typeof import('three'),
  object: THREE.Object3D,
): { center: THREE.Vector3; radius: number } | null {
  const box = new three.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new three.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return null;
  return { center: sphere.center, radius: sphere.radius };
}
