// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { invalidateVisibleBounds } from '../../scene/visibleBounds';
import type { SplatSceneHandle } from '../../useSplat';

/** Splats masked by a delete operation (original opacities kept for undo). */
export interface HiddenSplats {
  indices: number[];
  opacities: number[];
}

/**
 * Immediate reflection of a mutation of the packedSplats (11.C): `needsUpdate` only re-uploads the data
 * texture. Spark's sorted accumulator is rebuilt only if the mesh's generator is invalidated
 * (`updateGenerator`). Without it, the masking only appears at the next camera movement (or as a side
 * effect of detaching the highlight).
 */
export function commitPackedChange(handle: SplatSceneHandle): void {
  const packed = handle.mesh.packedSplats;
  if (packed) packed.needsUpdate = true;
  handle.mesh.updateGenerator();
  // The "visible" bbox (F/H framing, 11.D) depends on the opacities: cache to invalidate.
  invalidateVisibleBounds(handle.mesh);
}

/**
 * Non-destructive deletion of splats (10.G): sets the opacity to 0 in the packed data held in memory
 * (`PackedSplats.setSplat`). The original file is never modified; the mask is persisted separately (H5)
 * and re-applied on load. Returns the original opacities for the undo, or null if there is nothing to mask
 * (already masked / data unavailable).
 */
export function hideSplats(handle: SplatSceneHandle, indices: Iterable<number>): HiddenSplats | null {
  const packed = handle.mesh.packedSplats;
  if (!packed) return null;
  const hidden: HiddenSplats = { indices: [], opacities: [] };
  for (const i of indices) {
    const { center, scales, quaternion, opacity, color } = packed.getSplat(i);
    if (opacity <= 0) continue; // already masked
    hidden.indices.push(i);
    hidden.opacities.push(opacity);
    packed.setSplat(i, center, scales, quaternion, 0, color);
  }
  if (hidden.indices.length === 0) return null;
  commitPackedChange(handle);
  return hidden;
}

/** Undo: restores the original opacities of the masked splats. */
export function restoreSplats(handle: SplatSceneHandle, hidden: HiddenSplats): void {
  const packed = handle.mesh.packedSplats;
  if (!packed) return;
  hidden.indices.forEach((i, k) => {
    const { center, scales, quaternion, color } = packed.getSplat(i);
    packed.setSplat(i, center, scales, quaternion, hidden.opacities[k], color);
  });
  commitPackedChange(handle);
}

/** Redo: re-masks the splats of the operation. */
export function rehideSplats(handle: SplatSceneHandle, hidden: HiddenSplats): void {
  const packed = handle.mesh.packedSplats;
  if (!packed) return;
  for (const i of hidden.indices) {
    const { center, scales, quaternion, color } = packed.getSplat(i);
    packed.setSplat(i, center, scales, quaternion, 0, color);
  }
  commitPackedChange(handle);
}
