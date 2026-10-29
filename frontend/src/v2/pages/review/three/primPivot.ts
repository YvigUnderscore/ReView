// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * TRS gizmo pivot per prim (46.Q) — **pure** math.
 *
 * The gizmo cannot be attached to the object itself: with transforms baked into the vertices
 * (Blender export), the object's local origin is often at the world center, and the gizmo appeared
 * in the middle of the scene instead of on the manipulated geometry. It is therefore placed on a
 * **proxy** at the prim's bounding center, and each delta of the proxy is translated back into a
 * pose for the object, rotated around that center.
 */

export type Vec3 = [number, number, number];
/** Quaternion as [x, y, z, w] components — the order of `THREE.Quaternion.toArray()`. */
export type Quat = [number, number, number, number];

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

/** Quaternion product (a ∘ b: applies b, then a). */
export function mulQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotation of a vector by a quaternion (classic optimized form, no matrix). */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Local pose of an object in its parent's space. */
export interface Pose {
  position: Vec3;
  quaternion: Quat;
  scale: Vec3;
}

/** Delta read on the gizmo proxy since the start of the drag, expressed in parent space. */
export interface PivotDelta {
  t: Vec3;
  q: Quat;
  s: Vec3;
}

/**
 * Pose of the object after applying the delta **around the pivot**: the object→pivot offset is
 * scaled then rotated, the orientation composed, the scale multiplied. Everything is expressed in
 * the object's parent space — the caller converts the proxy's world delta into it.
 */
export function pivotedPose(base: Pose, pivot: Vec3, delta: PivotDelta): Pose {
  const offset: Vec3 = [
    (base.position[0] - pivot[0]) * delta.s[0],
    (base.position[1] - pivot[1]) * delta.s[1],
    (base.position[2] - pivot[2]) * delta.s[2],
  ];
  const rotated = rotateVec(delta.q, offset);
  return {
    position: [
      pivot[0] + rotated[0] + delta.t[0],
      pivot[1] + rotated[1] + delta.t[1],
      pivot[2] + rotated[2] + delta.t[2],
    ],
    quaternion: mulQuat(delta.q, base.quaternion),
    scale: [base.scale[0] * delta.s[0], base.scale[1] * delta.s[1], base.scale[2] * delta.s[2]],
  };
}
