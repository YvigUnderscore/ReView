// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatMesh } from '@sparkjsdev/spark';
import type { SplatTransform } from '../../reviewTypes';

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
