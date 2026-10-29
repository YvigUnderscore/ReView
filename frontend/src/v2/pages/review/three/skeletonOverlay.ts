// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/** True if the subtree contains at least one `SkinnedMesh` (rig present → skeleton debug 40.B). */
export function hasSkinnedMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) found = true;
  });
  return found;
}

/**
 * Skeleton debug overlay (Phase 40, 40.B): a `SkeletonHelper` (bone lines) drawn **on top of** the
 * model (depthTest disabled) so it stays visible through the geometry. Added to the scene; removed
 * and `dispose()`d when hidden. The helper updates itself in the render loop (it is part of the
 * scene graph), so it follows the rig's animation.
 */
export function createSkeletonOverlay(
  three: typeof import('three'),
  root: THREE.Object3D,
): THREE.SkeletonHelper {
  const helper = new three.SkeletonHelper(root);
  const mat = helper.material as THREE.LineBasicMaterial;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.transparent = true;
  helper.renderOrder = 999;
  return helper;
}
