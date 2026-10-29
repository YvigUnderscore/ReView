// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * Local bbox of the **visible** splats (opacity > 0), 11.D. Spark's `mesh.getBoundingBox` reads the
 * original data and therefore counts the splats masked by non-destructive deletion: after a
 * deletion, F/H reframed on the previous extent. Here a `forEachSplat` pass filters out the masked
 * ones; the result is cached per mesh and invalidated on every mask mutation (deletion, undo/redo,
 * persisted mask applied on load).
 */
const cache = new WeakMap<SplatMesh, THREE.Box3 | null>();

/** To call after any opacity mutation of the packedSplats (cf. deleteSplats). */
export function invalidateVisibleBounds(mesh: SplatMesh): void {
  cache.delete(mesh);
}

/**
 * Local bbox of the visible splats (cloned: consumers transform it into world space), or null if
 * there is no data or no visible splat. Falls back to `getBoundingBox` if `forEachSplat` is
 * unavailable.
 */
export function visibleLocalBox(three: typeof THREE, mesh: SplatMesh): THREE.Box3 | null {
  if (cache.has(mesh)) {
    const hit = cache.get(mesh) ?? null;
    return hit ? hit.clone() : null;
  }
  let box: THREE.Box3 | null = null;
  try {
    const b = new three.Box3();
    mesh.forEachSplat((_index, center, _scales, _quat, opacity) => {
      if (opacity <= 0) return;
      b.expandByPoint(center);
    });
    box = b.isEmpty() ? null : b;
  } catch {
    box = null;
  }
  if (!box) {
    try {
      const fallback = mesh.getBoundingBox(true);
      box = fallback.isEmpty() ? null : fallback.clone();
    } catch {
      box = null;
    }
  }
  cache.set(mesh, box);
  return box ? box.clone() : null;
}
