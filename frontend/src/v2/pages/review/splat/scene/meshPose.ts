// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatMesh } from '@sparkjsdev/spark';
import type { SplatTransform } from '../../reviewTypes';

/**
 * Applies a saved TRS transform to the SplatMesh (live preview of the gizmos, and on loading).
 * SplatMesh derives from THREE.Object3D, so position, quaternion and scale are native.
 * Tolerant: a missing value or one from an old format gives identity.
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
