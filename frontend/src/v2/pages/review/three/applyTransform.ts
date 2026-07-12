import type * as THREE from 'three';
import type { Transform } from '../reviewTypes';

const DEG2RAD = Math.PI / 180;

/**
 * Applique la transformation utilisateur (orientation yaw/pitch/roll en degrés + échelle
 * uniforme) au **groupe parent** du modèle (Phase 15, V2) — la normalisation par bbox reste sur
 * l'objet enfant. Pure/testable. La convention (yaw=Y, pitch=X, roll=Z) tient lieu de référence
 * du nouveau viewer ; les transforms héritées de model-viewer sont relues telles quelles.
 */
export function applyEulerTransform(root: THREE.Object3D, t: Transform): void {
  root.rotation.set(t.pitch * DEG2RAD, t.yaw * DEG2RAD, t.roll * DEG2RAD);
  root.scale.setScalar(t.scale);
}
