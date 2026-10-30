// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * "Point cloud" overlay of the `points` display mode (10.G), reactive to editing.
 *
 * Unlike a plain frozen `THREE.Points`, this overlay keeps a **1:1** mapping of point to splat
 * index (up to `MAX_POINTS`) so as to mirror, live:
 *  - the **selection** (orange tint, same colour code as the gaussian highlight: invisible on the
 *    mesh in points mode since its opacity is set to 0);
 *  - the **non-destructive deletion** (the masked point is carved out via a `NaN` position, hence
 *    discarded by the GPU), without rebuilding the cloud or changing mode.
 *
 * Updates are **incremental** (per-index diff) to stay smooth under the brush.
 */

/** Performance guard: maximum number of points built. */
const MAX_POINTS = 1_500_000;

/** Selection tint normalized to 0..1: mirror of `HIGHLIGHT_RGB` (#ffaa33) on the gaussian side. */
const SELECT_COLOR: readonly [number, number, number] = [1, 170 / 255, 51 / 255];

export interface PointCloud {
  points: THREE.Points;
  /** Mirrors the current selection (orange tint): incremental diff from the previous one. */
  setSelection(selected: ReadonlySet<number>): void;
  /** Masks (`hidden=true`) or restores points: non-destructive deletion mirrored live. */
  setHidden(indices: Iterable<number>, hidden: boolean): void;
  /** Replaces the set of points carved out by the crop volumes (a channel separate from the mask:
   *  removing a volume does not reveal a deleted point, and vice versa). Phase 28. */
  setCropped(indices: Iterable<number>): void;
  dispose(): void;
}

export function createPointCloud(THREE: typeof import('three'), mesh: SplatMesh): PointCloud {
  const total = mesh.packedSplats?.numSplats ?? 0;
  const n = Math.min(total, MAX_POINTS);
  const positions = new Float32Array(n * 3); // rendered buffer (NaN = masked point)
  const basePositions = new Float32Array(n * 3); // original centres (undo restore)
  const colors = new Float32Array(n * 3); // rendered buffer (base + tint)
  const baseColors = new Float32Array(n * 3); // original colours

  // Two independent carving channels: the deletion mask and the crop volumes (a point is
  // visible only outside both): see `setHidden` and `setCropped`.
  const maskHidden = new Set<number>();
  let cropped: ReadonlySet<number> = new Set<number>();

  mesh.forEachSplat((i, center, _scales, _quat, opacity, color) => {
    if (i >= n) return;
    const o = i * 3;
    basePositions[o] = center.x;
    basePositions[o + 1] = center.y;
    basePositions[o + 2] = center.z;
    const visible = opacity > 0; // already masked splats (loaded mask) are carved out
    if (!visible) maskHidden.add(i);
    positions[o] = visible ? center.x : NaN;
    positions[o + 1] = visible ? center.y : NaN;
    positions[o + 2] = visible ? center.z : NaN;
    baseColors[o] = color.r;
    baseColors[o + 1] = color.g;
    baseColors[o + 2] = color.b;
    colors[o] = color.r;
    colors[o + 1] = color.g;
    colors[o + 2] = color.b;
  });

  const geo = new THREE.BufferGeometry();
  // `BufferAttribute` (and not `Float32BufferAttribute`) keeps the Float32Array **by reference**:
  // our live writes (setSelection/setHidden) mutate the rendered buffer directly, then
  // `needsUpdate` re-uploads it. `Float32BufferAttribute` would make a copy (lost updates).
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  const material = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true });
  const points = new THREE.Points(geo, material);
  let tinted: ReadonlySet<number> = new Set<number>();

  const restoreColor = (i: number) => {
    const o = i * 3;
    colors[o] = baseColors[o]!;
    colors[o + 1] = baseColors[o + 1]!;
    colors[o + 2] = baseColors[o + 2]!;
  };

  /** Recomputes the visibility of a point (outside the mask AND outside the crop: original position). */
  const refresh = (i: number) => {
    const o = i * 3;
    const hide = maskHidden.has(i) || cropped.has(i);
    positions[o] = hide ? NaN : basePositions[o];
    positions[o + 1] = hide ? NaN : basePositions[o + 1];
    positions[o + 2] = hide ? NaN : basePositions[o + 2];
  };

  return {
    points,
    setSelection(selected) {
      for (const i of tinted) if (i < n && !selected.has(i)) restoreColor(i);
      const [r, g, b] = SELECT_COLOR;
      for (const i of selected) {
        if (i >= n || tinted.has(i)) continue;
        const o = i * 3;
        colors[o] = r;
        colors[o + 1] = g;
        colors[o + 2] = b;
      }
      tinted = new Set(selected);
      colAttr.needsUpdate = true;
    },
    setHidden(indices, hidden) {
      for (const i of indices) {
        if (i >= n) continue;
        if (hidden) maskHidden.add(i);
        else maskHidden.delete(i);
        refresh(i);
      }
      posAttr.needsUpdate = true;
    },
    setCropped(indices) {
      const next = new Set<number>();
      for (const i of indices) if (i < n) next.add(i);
      // Incremental diff: only points changing state are rewritten (after the swap,
      // so that `refresh` reads the new set).
      const prev = cropped;
      cropped = next;
      for (const i of prev) if (!next.has(i)) refresh(i);
      for (const i of next) if (!prev.has(i)) refresh(i);
      posAttr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      material.dispose();
      points.removeFromParent();
    },
  };
}
