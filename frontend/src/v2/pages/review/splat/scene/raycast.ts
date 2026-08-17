// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D } from '../../reviewTypes';

/**
 * Hotspot de surface (10.G) : lance un rayon au centre du viewer (NDC 0,0) sur le splat
 * `raycastable` et renvoie le point le plus proche + une normale face caméra (les splats
 * n'ont pas de normale de surface). Le point est stocké en **espace-objet** du mesh
 * (10.G-V10) : il suit la transformation du média (réorientation automatique). `null` si le
 * rayon ne touche rien. Extrait de `useSplat`.
 */
export function raycastCenter(
  THREE: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  mesh: SplatMesh,
): Hotspot3D | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
  mesh.raycast(raycaster, hits);
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.distance - b.distance);
  const p = hits[0].point;
  const n = camera.position.clone().sub(p).normalize();
  mesh.updateMatrixWorld();
  const local = p.clone().applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());
  return { position: `${local.x} ${local.y} ${local.z}`, normal: `${n.x} ${n.y} ${n.z}`, space: 'object' };
}
