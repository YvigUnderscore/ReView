import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import type { Hotspot3D, SplatTransform } from '../../reviewTypes';

/**
 * Applique une transformation TRS enregistrée au SplatMesh (preview live des gizmos et au
 * chargement). SplatMesh dérive de THREE.Object3D → position/quaternion/échelle natifs.
 * Tolérant : une valeur absente ou d'un ancien format → identité.
 */
export function applySplatTransform(mesh: SplatMesh, t: SplatTransform | null): void {
  if (t && Array.isArray(t.position) && Array.isArray(t.quaternion) && Array.isArray(t.scale)) {
    mesh.position.fromArray(t.position);
    mesh.quaternion.fromArray(t.quaternion);
    mesh.scale.fromArray(t.scale);
  } else {
    mesh.position.set(0, 0, 0);
    mesh.quaternion.set(0, 0, 0, 1);
    mesh.scale.set(1, 1, 1);
  }
}

/**
 * Interprète la position d'un hotspot (« x y z » + espace objet/monde) en point Three lu par la
 * boucle de rendu du viewer — null si la chaîne est invalide.
 */
export function parseHotspotPoint(
  three: typeof THREE,
  hs: Hotspot3D,
): { point: THREE.Vector3; objectSpace: boolean } | null {
  const [x, y, z] = hs.position.split(/\s+/).map((v) => parseFloat(v));
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { point: new three.Vector3(x, y, z), objectSpace: hs.space === 'object' }
    : null;
}
