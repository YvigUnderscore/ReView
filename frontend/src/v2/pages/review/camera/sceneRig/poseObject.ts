// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera } from '../../reviewTypes';

/**
 * Pure (testable) helpers for the **camera-object** in the scene (Phase 17): conversion between
 * the review pose (position + target) and the manipulable "object" representation (position +
 * look direction). The mesh orientation is done via `Object3D.lookAt` on the Three side; here we
 * only manipulate vectors, with no Three dependency.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Position→target distance (look radius kept when reorienting with the gizmo). */
export function lookDistance(pose: SplatCamera): number {
  const dx = pose.target.x - pose.position.x;
  const dy = pose.target.y - pose.position.y;
  const dz = pose.target.z - pose.position.z;
  return Math.hypot(dx, dy, dz);
}

/** Target rebuilt from a position, a (unit) view direction and a distance. */
export function targetFromForward(position: Vec3, forward: Vec3, dist: number): Vec3 {
  const len = Math.hypot(forward.x, forward.y, forward.z) || 1;
  return {
    x: position.x + (forward.x / len) * dist,
    y: position.y + (forward.y / len) * dist,
    z: position.z + (forward.z / len) * dist,
  };
}

/** Unit view direction of a pose (position → target), or -Z by default if degenerate. */
export function forwardOfPose(pose: SplatCamera): Vec3 {
  const dx = pose.target.x - pose.position.x;
  const dy = pose.target.y - pose.position.y;
  const dz = pose.target.z - pose.position.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return { x: 0, y: 0, z: -1 };
  return { x: dx / len, y: dy / len, z: dz / len };
}
