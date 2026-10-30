// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D } from '../../reviewTypes';

/**
 * Surface hotspot (10.G): casts a ray **where one points** (NDC) onto the `raycastable` splat and
 * returns the nearest point plus a normal facing the camera (splats have no surface normal). The
 * point is stored in the mesh's **object space** (10.G-V10): it follows the media transform
 * (automatic reorientation). `null` if the ray hits nothing. Extracted from `useSplat`.
 */
export function raycastAt(
  THREE: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  mesh: SplatMesh,
  ndc: { x: number; y: number },
): Hotspot3D | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
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
