// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatMesh } from '@sparkjsdev/spark';
import type { SplatSceneHandle } from '../../useSplat';
import { combineSelection, shapePredicate, type SelectCombine, type SelectionShape } from './shapes2d';

/**
 * Screen-space selection of splats (10.G, perf review in V2): the centres are captured **only
 * once** as a `Float32Array` (one `forEachSplat` pass on the first commit), then each commit
 * projects this buffer through the combined matrix (object → world → clip → pixels) in a flat
 * loop, without per-splat Three objects or repacking. Hidden splats (non-destructive deletion)
 * are excluded via `isHidden` (the buffer itself never changes).
 */

/** Captures the centres of all splats (one pass): selection cache. */
export function captureCenters(mesh: SplatMesh): Float32Array {
  const n = mesh.packedSplats?.numSplats ?? 0;
  const out = new Float32Array(n * 3);
  mesh.forEachSplat((i, center) => {
    const o = i * 3;
    out[o] = center.x;
    out[o + 1] = center.y;
    out[o + 2] = center.z;
  });
  return out;
}

/**
 * Projects the centres through the clip matrix (THREE column-major) and collects the indices
 * whose screen projection satisfies the predicate. Pure and testable (no Three dependency).
 */
export function collectHits(
  e: ArrayLike<number>,
  centers: Float32Array,
  isHidden: (index: number) => boolean,
  viewport: { width: number; height: number },
  hit: (x: number, y: number) => boolean,
): number[] {
  const { width, height } = viewport;
  const hits: number[] = [];
  const n = centers.length / 3;
  for (let i = 0; i < n; i++) {
    if (isHidden(i)) continue;
    const x = centers[3 * i];
    const y = centers[3 * i + 1];
    const z = centers[3 * i + 2];
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 0) continue; // behind the camera
    const cz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
    if (cz >= 1 || cz <= -1) continue; // outside the near/far frustum
    const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5;
    const sy = ((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * -0.5 + 0.5;
    if (hit(sx * width, sy * height)) hits.push(i);
  }
  return hits;
}

/** Applies a shape drawn on screen to the current selection (on drag release). */
export function selectByShape(
  handle: SplatSceneHandle,
  centers: Float32Array,
  isHidden: (index: number) => boolean,
  viewport: { width: number; height: number },
  shape: SelectionShape,
  prev: ReadonlySet<number>,
  combine: SelectCombine,
): Set<number> {
  const { THREE, camera, mesh } = handle;
  mesh.updateWorldMatrix(true, false);
  const m = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(mesh.matrixWorld);
  const hits = collectHits(m.elements, centers, isHidden, viewport, shapePredicate(shape));
  return combineSelection(prev, hits, combine);
}
