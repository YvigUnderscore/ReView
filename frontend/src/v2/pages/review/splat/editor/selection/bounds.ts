// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { visibleLocalBox } from '../../scene/visibleBounds';
import type { SplatSceneHandle } from '../../useSplat';

/**
 * Bounding spheres for camera framing (`F` shortcut, 10.G-V1): current selection or
 * whole splat, expressed in **world** space (the mesh transform, i.e. gizmos, is applied).
 * Hidden splats (opacity 0, non-destructive deletion) are ignored.
 */
/**
 * What framing needs to read: the Three module and the mesh, nothing more. The type used to be
 * the whole scene handle, which forced building one just to measure a radius.
 */
export type SplatBoundsSource = Pick<SplatSceneHandle, 'THREE' | 'mesh'>;

export interface BoundsSphere {
  center: THREE.Vector3;
  radius: number;
}

/** Bounding sphere of the selected splats (world), or null if the selection is empty or degenerate. */
export function selectionBounds(
  handle: SplatBoundsSource,
  selected: ReadonlySet<number>,
): BoundsSphere | null {
  if (selected.size === 0) return null;
  const { THREE, mesh } = handle;
  const box = new THREE.Box3();
  const world = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false); // ancestors included (flip pivot, 11.E)
  mesh.forEachSplat((index, center, _scales, _quat, opacity) => {
    if (opacity <= 0 || !selected.has(index)) return;
    world.copy(center).applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(world);
  });
  const sphere = sphereFromBox(THREE, box);
  // Near-point selection (1 splat): floor radius for a usable framing.
  return sphere ? { ...sphere, radius: Math.max(sphere.radius, 0.05) } : null;
}

/** Bounding sphere of the visible splats of the mesh (world), or null if unavailable (11.D). */
export function meshBounds(handle: SplatBoundsSource): BoundsSphere | null {
  const { THREE, mesh } = handle;
  const local = visibleLocalBox(THREE, mesh);
  if (!local) return null;
  mesh.updateWorldMatrix(true, false); // ancestors included (flip pivot, 11.E)
  const box = local.applyMatrix4(mesh.matrixWorld);
  return sphereFromBox(THREE, box);
}

function sphereFromBox(three: typeof THREE, box: THREE.Box3): BoundsSphere | null {
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new three.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius < 0) return null;
  return { center: sphere.center, radius: sphere.radius };
}
