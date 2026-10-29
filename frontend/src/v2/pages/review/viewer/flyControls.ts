// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isEditable } from '../../../lib/shortcuts';
import { applyRoll, rollFromCamera } from '../three/cameraRoll';
import { inhibitOrbit } from './controlsLock';

/**
 * Unreal-style "fly" navigation (10.G-V1): holding the right click = mouse look + keyboard
 * movement ZQSD/WASD (physical codes, so AZERTY and QWERTY behave the same) + A/E down/up,
 * wheel = flight speed, Shift = accelerate. OrbitControls is frozen during the flight, then
 * re-synced (target moved in front of the camera, at constant distance) for a consistent
 * orbit resume.
 *
 * The **tilt** (roll from the Camera panel) is part of the fly pose: see `flyLookEuler`.
 *
 * Holding the right click is a **navigation mode**: while it lasts, the keyboard belongs to the
 * flight and to nothing else (the review chrome and the editor stay silent, see
 * `useChromeState`). A **short** right click is not a flight: it is the context menu, served by
 * `useSpatialContextMenu` — this module only blocks the browser's native menu.
 *
 * Local implementation rather than Spark's `FpsMovement`: that one attaches its `document`
 * listeners in its constructor and never removes them (a leak on every viewer remount).
 * Its physical-code mapping is kept, with listeners that are properly disposed.
 */

/** Physical code → local camera direction mapping (X right, Y up, -Z forward). */
export const FLY_MOVE_MAPPING: Record<string, readonly [number, number, number]> = {
  KeyW: [0, 0, -1], // Z (AZERTY) / W: forward
  KeyS: [0, 0, 1], // S: backward
  KeyA: [-1, 0, 0], // Q (AZERTY) / A: left
  KeyD: [1, 0, 0], // D: right
  KeyE: [0, 1, 0], // E: up
  KeyQ: [0, -1, 0], // A (AZERTY) / Q: down
};

/** Speed multiplier while Shift is held (as in FpsMovement). */
export const FLY_SHIFT_MULTIPLIER = 5;

/**
 * Does this key belong to the flight? **Single source of truth** for the flight keys: three
 * competing keyboard handlers live on `window`/`document` (this module, the review chrome, the
 * camera animation auto-pause) and must all agree on the same set of physical codes. Copying
 * the list would let it drift.
 */
export function isFlyMoveCode(code: string): boolean {
  return code in FLY_MOVE_MAPPING;
}

/** Look sensitivity (radians per pixel of mouse movement). */
const LOOK_SPEED = 0.0035;

/**
 * Beyond this vertical component of the view, the frame used to measure the roll is degenerate
 * (`cameraRoll.baseUp` flips axis there): the tilt is no longer read.
 */
const VERTICAL_LIMIT = 0.999;

/**
 * Look pose during the flight (Euler `YXZ`): yaw and pitch come from the mouse, **the roll comes
 * from the tilt**. Pure, testable.
 *
 * WHY. The Camera panel tilt lives in `camera.up`, which only `lookAt` reads — and OrbitControls
 * is frozen during the flight. The pose composed here used to force `z = 0`: the roll dropped
 * flat on the first mouse movement and only came back on landing, when the orbit took over again
 * and reframed the camera. It is now part of the fly pose.
 *
 * `z = -roll`: in `YXZ` order, `Rz` rotates around the view axis, and the angle measured by
 * `rollFromUp` (that of `up` around `forward`) has the opposite sign — a +30° tilt therefore
 * composes as `z = -30°`. This is exactly the orientation `lookAt` would produce with the `up`
 * from `applyRoll`: nothing jumps on landing.
 */
export function flyLookEuler(
  look: { x: number; y: number },
  movement: { x: number; y: number },
  roll: number,
): { x: number; y: number; z: number } {
  const dx = Number.isFinite(movement.x) ? movement.x : 0;
  const dy = Number.isFinite(movement.y) ? movement.y : 0;
  const limit = Math.PI / 2;
  return {
    x: Math.max(-limit, Math.min(limit, look.x - dy * LOOK_SPEED)),
    y: look.y - dx * LOOK_SPEED,
    // `roll !== 0`: without tilt, return a plain 0 rather than the -0 of the negation.
    z: Number.isFinite(roll) && roll !== 0 ? -roll : 0,
  };
}

/** Local movement direction (normalized) from the pressed codes — pure, testable. */
export function moveDirection(pressed: ReadonlySet<string>): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const code of pressed) {
    const dir = FLY_MOVE_MAPPING[code];
    if (!dir) continue;
    x += dir[0];
    y += dir[1];
    z += dir[2];
  }
  const len = Math.hypot(x, y, z);
  return len > 0 ? [x / len, y / len, z / len] : [0, 0, 0];
}

export interface FlyControls {
  /** Flight in progress (right click held on the canvas). */
  readonly flying: boolean;
  /** Call every frame with the delta in seconds; does nothing outside the flight. */
  update(dt: number): void;
  dispose(): void;
}

export function createFlyControls(
  THREE: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  dom: HTMLElement,
): FlyControls {
  // Right click switches to flight: the orbit keeps left = rotate, wheel = zoom, and pan
  // moves to the middle button (DCC convention).
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = null;

  const pressed = new Set<string>();
  let flying = false;
  let shift = false;
  let speed = 1; // units/s, re-scaled to the scene's scale at each flight start
  let roll = 0; // tilt of the plane, re-read from `camera.up` during the flight (see `onPointerMove`)
  let orbitDistance = 1; // camera→target distance at start, restored on landing
  let pointerId = -1;
  // Orbit inhibition token held during the flight (see `controlsLock`): nobody writes
  // `controls.enabled` directly anymore, otherwise a gizmo unmount restored the orbit mid-flight.
  let releaseOrbit: (() => void) | null = null;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const move = new THREE.Vector3();
  const forward = new THREE.Vector3();

  const endFlight = () => {
    if (!flying) return;
    flying = false;
    if (pointerId >= 0 && dom.hasPointerCapture?.(pointerId)) dom.releasePointerCapture(pointerId);
    pointerId = -1;
    // Re-sync the orbit target in front of the camera, at the flight start distance.
    move.set(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).addScaledVector(move, orbitDistance);
    releaseOrbit?.();
    releaseOrbit = null;
    controls.update();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 2 || flying) return;
    flying = true;
    pointerId = e.pointerId;
    // The flight starts **from rest**, with the real Shift state: direction keys only accumulate
    // during the flight, and a key already held at press time does not belong to the flight.
    pressed.clear();
    shift = e.shiftKey;
    orbitDistance = Math.max(camera.position.distanceTo(controls.target), 0.01);
    speed = Math.max(orbitDistance, 0.1);
    releaseOrbit = inhibitOrbit(controls, 'fly'); // freeze the orbit during the flight
    try {
      dom.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers without capture (tests, automation): the flight stays functional.
    }
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!flying) return;
    // The tilt is re-read from the camera **orientation** on every movement, then realigned with
    // the new view direction: the read is idempotent (`rollFromUp` exactly inverts `applyRoll`),
    // and a panel adjustment made during the flight is taken as is. Reading it from
    // `camera.up` no longer works: outside the flight the tilt is no longer frozen there but
    // recomposed into the orientation on every turn (see `cameraRoll.updateOrbitKeepingRoll`),
    // and `up` is flat — so the first mouse movement reset the roll to zero. Except for a
    // near-vertical view: the measurement frame is degenerate there, so we keep the last tilt
    // read rather than letting the camera spin at the zenith.
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (Math.abs(forward.y) < VERTICAL_LIMIT) roll = rollFromCamera(THREE, camera);
    euler.setFromQuaternion(camera.quaternion);
    const look = flyLookEuler(euler, { x: e.movementX, y: e.movementY }, roll);
    euler.x = look.x;
    euler.y = look.y;
    euler.z = look.z;
    camera.quaternion.setFromEuler(euler);
    // `camera.up` stays aligned during the flight: it is what the `lookAt` of the landing
    // `controls.update()` (`endFlight`) reads, before the loop takes over again — otherwise the
    // tilt would drop flat for a frame while the orbit resumes.
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    applyRoll(THREE, camera, forward, roll);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.button === 2) endFlight();
  };

  const onWheel = (e: WheelEvent) => {
    if (!flying) return;
    e.preventDefault(); // no orbit zoom during the flight: the wheel sets the speed
    speed *= e.deltaY < 0 ? 1.25 : 0.8;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // OUTSIDE THE FLIGHT, the keyboard does not belong to the flight. Keys used to accumulate
    // permanently, text input included: holding a direction without clicking did nothing
    // visible, then the right click started a flight **already moving**. The held right click is
    // the navigation mode — it starts there, and the keyboard with it.
    if (!flying || isEditable(e.target)) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shift = true;
    if (!isFlyMoveCode(e.code)) return;
    pressed.add(e.code);
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    // Key release is never filtered: a key released after landing (or outside the window) must
    // leave the set, otherwise the direction stays stuck.
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shift = false;
    pressed.delete(e.code);
  };
  const onBlur = () => {
    pressed.clear();
    shift = false;
    endFlight();
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    get flying() {
      return flying;
    },
    update(dt: number) {
      if (!flying || dt <= 0) return;
      const [x, y, z] = moveDirection(pressed);
      if (x === 0 && y === 0 && z === 0) return;
      move.set(x, y, z).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(move, speed * (shift ? FLY_SHIFT_MULTIPLIER : 1) * dt);
    },
    dispose() {
      endFlight();
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
