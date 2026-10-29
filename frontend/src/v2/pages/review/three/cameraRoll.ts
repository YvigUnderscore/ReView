// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Tilt (roll) of the camera around the view axis. Pure and testable, shared by the 3D viewer and the splat.
 * `roll = 0` → level horizon (up = projection of +Y perpendicular to the view). `roll` in radians.
 *
 * TWO CARRIERS OF THE TILT, AND THIS IS DELIBERATE.
 * - **`camera.up`** (`applyRoll`) for a camera oriented by a **one-off** `lookAt`: the PiP camera
 *   (`three/applyPose`), a restored pose, a panel setting. There, `up` is the instruction given to the
 *   `lookAt` that follows immediately: the result is exact.
 * - **the orientation** (`rollOrientation`) for a camera that one makes **rotate**: orbit and flight.
 *   An `up` frozen in the world frame stops describing the set tilt as soon as the view direction
 *   changes; the tilt is therefore treated for what it is, an angle (`updateOrbitKeepingRoll`).
 *
 * The two forms are interchangeable and the test locks it in: `lookAt` with the `up` of `applyRoll`
 * gives exactly the orientation that `rollOrientation` composes after a flat `lookAt`.
 * `rollFromCamera` reads the displayed tilt without having to know which of the two set it.
 */

/** Non-rolled up: component of +Y (or +Z for a vertical view) perpendicular to `forward`. */
function baseUp(three: typeof import('three'), forward: THREE.Vector3): THREE.Vector3 {
  const worldUp = new three.Vector3(0, 1, 0);
  const up = worldUp.clone().addScaledVector(forward, -worldUp.dot(forward));
  if (up.lengthSq() < 1e-8) {
    // Near-vertical view: switches to +Z to avoid a degenerate up.
    const alt = new three.Vector3(0, 0, 1);
    up.copy(alt).addScaledVector(forward, -alt.dot(forward));
  }
  return up.normalize();
}

/** Applies the roll: sets `camera.up`. `forward` = view direction (target minus position). */
export function applyRoll(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  forward: THREE.Vector3,
  roll: number,
): void {
  if (!roll) {
    // Zero roll: default world up (Phase 26, tilt fix). It no longer freezes an up projected onto the
    // current view, which became obsolete as soon as one orbited afterwards (residual tilt). Near-vertical
    // view excepted (up parallel to the view, degenerate lookAt): the projected up is kept.
    const f0 = forward.clone().normalize();
    if (Math.abs(f0.y) > 0.9999) camera.up.copy(baseUp(three, f0));
    else camera.up.set(0, 1, 0);
    return;
  }
  const f = forward.clone().normalize();
  const up = baseUp(three, f);
  const perp = new three.Vector3().crossVectors(f, up); // in the plane perpendicular to the view
  up.multiplyScalar(Math.cos(roll)).addScaledVector(perp, Math.sin(roll)).normalize();
  camera.up.copy(up);
}

/** Reads the current roll from `camera.up` and the view direction (signed angle around `forward`). */
export function rollFromUp(three: typeof import('three'), forward: THREE.Vector3, up: THREE.Vector3): number {
  const f = forward.clone().normalize();
  const base = baseUp(three, f);
  const u = up.clone().normalize();
  const perp = new three.Vector3().crossVectors(f, base);
  return Math.atan2(perp.dot(u), base.dot(u));
}

/** Below this angle (radians) the horizon is level: there is no tilt to keep. */
const ROLL_EPSILON = 1e-6;

/**
 * Tilt **actually displayed**, read from the camera's orientation (its local +Y axis) and not from
 * `camera.up`. It is the only reliable reading: `camera.up` is the *instruction* given to `lookAt`,
 * the orientation is the *result*, and the two diverge as soon as the view is rotated.
 */
export function rollFromCamera(three: typeof import('three'), camera: THREE.PerspectiveCamera): number {
  const forward = new three.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const up = new three.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  return rollFromUp(three, forward, up);
}

/**
 * Composes the tilt into the **orientation**, around the view axis, after a `lookAt` without roll.
 * `-roll`: the angle measured by `rollFromUp` (that of `up` around `forward`) has the opposite sign
 * to a rotation around the local +Z: same convention as `flyControls.flyLookEuler`, and the result is
 * exactly the orientation that `lookAt` would produce with the `up` of `applyRoll`.
 */
export function rollOrientation(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  roll: number,
): void {
  if (!Number.isFinite(roll) || Math.abs(roll) < ROLL_EPSILON) return;
  camera.quaternion.multiply(new three.Quaternion().setFromAxisAngle(new three.Vector3(0, 0, 1), -roll));
}

/**
 * `controls.update()` that **keeps the tilt**: to be called instead of `controls.update()` in the
 * render loop (both viewers).
 *
 * WHY. `OrbitControls.update()` ends with `object.lookAt(target)`, which rebuilds the orientation from
 * `camera.up`. The tilt of the Camera panel lives precisely in `camera.up` (`applyRoll`), as a vector
 * frozen **in the world frame**, projected onto the view direction we had at the time of the setting.
 * Orbiting changes that direction without touching the vector: the angle between `up` and the horizon
 * of the new view is no longer the one we set, and the camera seems to take on a rotation as one drags
 * with the left button. The orbit pole itself is not at fault: OrbitControls freezes it at construction
 * (`_quat`, read only once).
 *
 * The tilt is therefore treated for what it is: an **angle**, read before the orbit and recomposed after.
 * `camera.up` restarts flat before `lookAt` (the exact state of zero tilt, the only path where the orbit
 * was already stable), and the angle is put back into the orientation. At zero tilt, nothing happens.
 */
export function updateOrbitKeepingRoll(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
): void {
  const roll = rollFromCamera(three, camera);
  const forward = new three.Vector3().subVectors(controls.target, camera.position);
  // Level horizon, or camera coinciding with its target (`lookAt` is degenerate there): bare orbit.
  if (Math.abs(roll) < ROLL_EPSILON || forward.lengthSq() < 1e-12) {
    controls.update();
    return;
  }
  applyRoll(three, camera, forward, 0);
  controls.update();
  rollOrientation(three, camera, roll);
}

/**
 * **Actually displayed** camera view (position/target/roll), read from the camera's pose (quaternion),
 * not from `controls.target`: during flight (right click), OrbitControls is frozen and its target is
 * only re-set on release; capturing the controls' target froze the rotation broadcast in the live
 * session (feedback 33). The target is reprojected in front of the camera at the current orbit distance;
 * out of flight (camera oriented by `lookAt`), the result is identical to the former reading of the controls.
 */
export function captureCameraView(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3 },
): {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
  aspect: number;
  roll?: number;
} {
  const dist = Math.max(camera.position.distanceTo(controls.target), 1e-3);
  const forward = new three.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const target = camera.position.clone().addScaledVector(forward, dist);
  const up = new three.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const view: ReturnType<typeof captureCameraView> = {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: target.x, y: target.y, z: target.z },
    fov: camera.fov,
    aspect: camera.aspect,
  };
  const roll = rollFromUp(three, forward, up);
  if (Math.abs(roll) > 1e-4) view.roll = roll;
  return view;
}
