import type { SplatTransform } from '../../reviewTypes';

/** Formes structurelles minimales d'un mesh Three (évite de dépendre de THREE dans les tests). */
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
 * Lit la transformation TRS (position/quaternion/échelle) d'un mesh manipulé par le gizmo.
 * Fonction pure — le `SplatMesh` (dérivé de THREE.Object3D) satisfait `TransformableMesh`.
 */
export function readMeshTransform(mesh: TransformableMesh): SplatTransform {
  return {
    position: mesh.position.toArray() as [number, number, number],
    quaternion: [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w],
    scale: mesh.scale.toArray() as [number, number, number],
  };
}
