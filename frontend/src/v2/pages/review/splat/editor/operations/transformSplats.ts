// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatSceneHandle } from '../../useSplat';
import { commitPackedChange } from './deleteSplats';

/**
 * Transform d'un **sous-ensemble** de splats (Phase 28) : déplacer/tourner/redimensionner
 * uniquement les splats sélectionnés, autour de leur **barycentre**, en réécrivant les centres,
 * quaternions et échelles dans les données paquées en mémoire (`PackedSplats.setSplat`) — le
 * fichier original n'est jamais modifié, l'opération est annulable (snapshot des valeurs d'origine).
 * La logique de gizmo (proxy au barycentre) vit dans `useSubsetTransform`.
 */

/** État d'origine des splats sélectionnés + barycentre local (pivot du gizmo). */
export interface SubsetSnapshot {
  indices: number[];
  center: THREE.Vector3[];
  scales: THREE.Vector3[];
  quaternion: THREE.Quaternion[];
  opacity: number[];
  color: THREE.Color[];
  pivot: THREE.Vector3;
}

/** Barycentre (moyenne) d'un lot de centres, pur/testable. Renvoie [0,0,0] si vide. */
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

/** Capture l'état d'origine des splats (centre/échelle/quaternion/opacité/couleur) + barycentre. */
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
 * Applique une transformation `delta` (matrice locale au mesh, exprimée autour du pivot par le
 * gizmo) aux splats du snapshot : centre passé par la matrice, quaternion pré-multiplié par la
 * rotation, échelle multipliée par le facteur d'échelle. Réécrit les données paquées.
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

/** Restaure l'état d'origine des splats du snapshot (undo). */
export function restoreSubset(handle: SplatSceneHandle, snap: SubsetSnapshot): void {
  const packed = handle.mesh.packedSplats;
  if (!packed) return;
  snap.indices.forEach((i, k) => {
    packed.setSplat(i, snap.center[k], snap.scales[k], snap.quaternion[k], snap.opacity[k], snap.color[k]);
  });
  commitPackedChange(handle);
}
