// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatMesh } from '@sparkjsdev/spark';
import { visibleLocalBox } from './visibleBounds';

/**
 * Auto-cadrage caméra (10.G) : cale la caméra + la cible OrbitControls sur la bbox du splat,
 * de sorte que la sphère englobante tienne dans le plus contraint des FOV (portrait inclus).
 * Renvoie `true` si le cadrage a pu être calculé (bbox valide), sinon `false` (repli sur la
 * position par défaut). Extrait de `useSplat` — logique de scène isolée, sans état React.
 * Le cadrage générique `frameCameraToSphere` (raccourci F) vit dans `viewer/frameCamera`.
 */
export function frameCameraToMesh(
  THREE: typeof import('three'),
  mesh: SplatMesh,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): boolean {
  try {
    // Centres des splats visibles uniquement (11.D) : après suppression, H recadre sur ce qui
    // reste — repli sur la bbox Spark complète si les données ne sont pas disponibles.
    // Passage en monde (11.E) : le flip d'orientation porté par le groupe parent (et la
    // transform utilisateur du mesh) déplacent le centre réel à cadrer.
    const box = visibleLocalBox(THREE, mesh);
    if (!box) return false;
    mesh.updateWorldMatrix(true, false); // ancêtres inclus (pivot de flip pas encore rendu)
    box.applyMatrix4(mesh.matrixWorld);
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
