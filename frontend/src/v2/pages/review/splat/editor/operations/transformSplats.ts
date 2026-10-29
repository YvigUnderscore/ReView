// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatSceneHandle } from '../../useSplat';
import { commitPackedChange } from './deleteSplats';

/**
 * Transform of a **subset** of splats (Phase 28): moves, rotates or resizes only the selected splats, around
 * their **barycentre**, by rewriting the centres, quaternions and scales in the packed data held in memory
 * (`PackedSplats.setSplat`). The original file is never modified; the operation is undoable (snapshot of the
 * original values). The gizmo logic (proxy at the barycentre) lives in `useSubsetTransform`.
 */

/** Original state of the selected splats, plus the local barycentre (the gizmo's pivot). */
export interface SubsetSnapshot {
  indices: number[];
  center: THREE.Vector3[];
  scales: THREE.Vector3[];
  quaternion: THREE.Quaternion[];
  opacity: number[];
  color: THREE.Color[];
  pivot: THREE.Vector3;
}

/** Barycentre (mean) of a batch of centres, pure and testable. Returns [0,0,0] if empty. */
export function centroidOfCenters(
  centers: Float32Array,
  indices: readonly number[],
): [number, number, number] {
  if (indices.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of indices) {
    x += centers[3 * i] ?? 0;
    y += centers[3 * i + 1] ?? 0;
    z += centers[3 * i + 2] ?? 0;
  }
  const n = indices.length;
  return [x / n, y / n, z / n];
}

/** Captures the original state of the splats (centre, scale, quaternion, opacity, colour) plus barycentre. */
export function snapshotSubset(handle: SplatSceneHandle, selected: Iterable<number>): SubsetSnapshot | null {
  const packed = handle.mesh.packedSplats;
  if (!packed) return null;
  const { THREE } = handle;
  const indices = [...selected];
  if (indices.length === 0) return null;
  const snap: SubsetSnapshot = {
    indices,
    center: [],
    scales: [],
    quaternion: [],
    opacity: [],
    color: [],
    pivot: new THREE.Vector3(),
  };
  for (const i of indices) {
    const s = packed.getSplat(i);
    snap.center.push(s.center.clone());
    snap.scales.push(s.scales.clone());
    snap.quaternion.push(s.quaternion.clone());
    snap.opacity.push(s.opacity);
    snap.color.push(s.color.clone());
    snap.pivot.add(s.center);
  }
  snap.pivot.multiplyScalar(1 / indices.length);
  return snap;
}

/**
 * Applies a transform `delta` (a local matrix of the mesh, expressed around the pivot by the gizmo) to the
 * splats of the snapshot: centre passed through the matrix, quaternion pre-multiplied by the rotation, scale
 * multiplied by the scale factor. Rewrites the packed data.
 */
export function applySubsetDelta(handle: SplatSceneHandle, snap: SubsetSnapshot, delta: THREE.Matrix4): void {
  const packed = handle.mesh.packedSplats;
  if (!packed) return;
  const { THREE } = handle;
  const dPos = new THREE.Vector3();
  const dQuat = new THREE.Quaternion();
  const dScale = new THREE.Vector3();
  delta.decompose(dPos, dQuat, dScale);
  const c = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  snap.indices.forEach((i, k) => {
    c.copy(snap.center[k]).applyMatrix4(delta);
    q.copy(dQuat).multiply(snap.quaternion[k]);
    sc.copy(snap.scales[k]).multiply(dScale);
    packed.setSplat(i, c, sc, q, snap.opacity[k], snap.color[k]);
  });
  commitPackedChange(handle);
}

/** Restores the original state of the snapshot's splats (undo). */
export function restoreSubset(handle: SplatSceneHandle, snap: SubsetSnapshot): void {
  const packed = handle.mesh.packedSplats;
  if (!packed) return;
  snap.indices.forEach((i, k) => {
    packed.setSplat(i, snap.center[k], snap.scales[k], snap.quaternion[k], snap.opacity[k], snap.color[k]);
  });
  commitPackedChange(handle);
}
