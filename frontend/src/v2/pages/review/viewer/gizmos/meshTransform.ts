// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatTransform } from '../../reviewTypes';

/** Minimal structural shapes of a Three mesh (avoids depending on THREE in tests). */
interface Vec3Like {
  toArray(): number[];
}
interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface TransformableMesh {
  position: Vec3Like;
  quaternion: QuatLike;
  scale: Vec3Like;
}

/**
 * Reads the TRS transform (position/quaternion/scale) of a mesh manipulated by the gizmo.
 * Pure function: `SplatMesh` (derived from THREE.Object3D) satisfies `TransformableMesh`.
 */
export function readMeshTransform(mesh: TransformableMesh): SplatTransform {
  return {
    position: mesh.position.toArray() as [number, number, number],
    quaternion: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
    scale: mesh.scale.toArray() as [number, number, number],
  };
}
