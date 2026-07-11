import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatMesh } from '@sparkjsdev/spark';
import { visibleLocalBox } from './visibleBounds';

/**
 * Auto-cadrage caméra (10.G) : cale la caméra + la cible OrbitControls sur la bbox du splat,
 * de sorte que la sphère englobante tienne dans le plus contraint des FOV (portrait inclus).
 * Renvoie `true` si le cadrage a pu être calculé (bbox valide), sinon `false` (repli sur la
 * position par défaut). Extrait de `useSplat` — logique de scène isolée, sans état React.
 */
/**
 * Cadre la caméra sur une sphère englobante en conservant la direction de vue courante
 * (raccourci `F` : cadrer la sélection ou l'objet sans réorienter). Ajuste near/far et la
 * cible OrbitControls. Renvoie `false` si la sphère est dégénérée.
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

export function frameCameraToMesh(
  THREE: typeof import('three'),
  mesh: SplatMesh,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): boolean {
  try {
    // Centres des splats visibles uniquement (11.D) : après suppression, H recadre sur ce qui
    // reste — repli sur la bbox Spark complète si les données ne sont pas disponibles.
    const box = visibleLocalBox(THREE, mesh);
    if (!box) return false;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    if (!Number.isFinite(radius) || radius <= 0) return false;
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.2;
    camera.position.copy(center).add(new THREE.Vector3(0, 0, dist));
    camera.near = Math.max(radius / 100, 0.001);
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    return true;
  } catch {
    // bbox indisponible → on conserve la position par défaut (0,0,3).
    return false;
  }
}
