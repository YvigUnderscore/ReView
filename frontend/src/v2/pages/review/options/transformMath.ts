// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Euler degrees ↔ quaternion conversions (intrinsic XYZ order, three.js conventions) for the numeric
 * TRS fields (10.G-V4). Pure and without a Three dependency: testable, and usable on both sides
 * (display of the gizmo's quaternion in degrees, input in degrees → quaternion).
 */
export type Quat = [number, number, number, number];
export type EulerDeg = [number, number, number];

const RAD = Math.PI / 180;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Quaternion [x,y,z,w] → XYZ Euler angles in degrees (same formulas as THREE.Euler). */
export function quatToEulerDeg([x, y, z, w]: Quat): EulerDeg {
  // Terms of the rotation matrix needed for the XYZ order.
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(clamp(m13, -1, 1));
  let ex: number;
  let ez: number;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    // Gimbal lock: Z arbitrarily set to 0 (three.js convention).
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  return [ex / RAD, ey / RAD, ez / RAD];
}

/** XYZ Euler angles in degrees → quaternion [x,y,z,w] (same formulas as THREE.Quaternion). */
export function eulerDegToQuat([exDeg, eyDeg, ezDeg]: EulerDeg): Quat {
  const c1 = Math.cos((exDeg * RAD) / 2);
  const s1 = Math.sin((exDeg * RAD) / 2);
  const c2 = Math.cos((eyDeg * RAD) / 2);
  const s2 = Math.sin((eyDeg * RAD) / 2);
  const c3 = Math.cos((ezDeg * RAD) / 2);
  const s3 = Math.sin((ezDeg * RAD) / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}
