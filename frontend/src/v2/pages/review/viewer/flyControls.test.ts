// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as three from 'three';
import {
  createFlyControls,
  flyLookEuler,
  FLY_MOVE_MAPPING,
  isFlyMoveCode,
  moveDirection,
} from './flyControls';
import { applyRoll, rollFromCamera } from '../three/cameraRoll';
import { orbitInhibitors, inhibitOrbit } from './controlsLock';

describe('moveDirection', () => {
  it('maps the physical ZQSD/WASD codes + A/E (up/down)', () => {
    expect(moveDirection(new Set(['KeyW']))).toEqual([0, 0, -1]);
    expect(moveDirection(new Set(['KeyS']))).toEqual([0, 0, 1]);
    expect(moveDirection(new Set(['KeyA']))).toEqual([-1, 0, 0]);
    expect(moveDirection(new Set(['KeyD']))).toEqual([1, 0, 0]);
    expect(moveDirection(new Set(['KeyE']))).toEqual([0, 1, 0]); // up
    expect(moveDirection(new Set(['KeyQ']))).toEqual([0, -1, 0]); // down
  });

  it('normalizes diagonals and cancels opposite directions', () => {
    const [x, , z] = moveDirection(new Set(['KeyW', 'KeyD']));
    expect(Math.hypot(x, z)).toBeCloseTo(1);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(z).toBeCloseTo(-Math.SQRT1_2);
    expect(moveDirection(new Set(['KeyW', 'KeyS']))).toEqual([0, 0, 0]);
  });

  it('ignores codes outside the mapping', () => {
    expect(moveDirection(new Set(['KeyX', 'Space']))).toEqual([0, 0, 0]);
    expect(Object.keys(FLY_MOVE_MAPPING)).toHaveLength(6);
  });
});

/**
 * Minimal three.js stub: flying only uses three vectors and an Euler. The camera does not rotate
 * in these tests (`applyQuaternion` is the identity), which is enough: we measure who moves and
 * when, not in which direction (`moveDirection` handles that, just above).
 */
class V3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: V3) {
    return this.set(v.x, v.y, v.z);
  }
  applyQuaternion() {
    return this;
  }
  addScaledVector(v: V3, s: number) {
    return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s);
  }
  distanceTo(v: V3) {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
}

const THREE = {
  MOUSE: { PAN: 2 },
  Vector3: V3,
  Euler: class {
    x = 0;
    y = 0;
    z = 0;
    setFromQuaternion() {
      return this;
    }
  },
} as unknown as typeof import('three');

function setup() {
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  const camera = { position: new V3(0, 0, 5), quaternion: { setFromEuler: vi.fn() } };
  const controls = { enabled: true, target: new V3(), mouseButtons: {}, update: vi.fn() };
  const fly = createFlyControls(
    THREE,
    camera as unknown as Parameters<typeof createFlyControls>[1],
    controls as unknown as Parameters<typeof createFlyControls>[2],
    dom,
  );
  return { dom, camera, controls, fly };
}

/** Right button pressed on the canvas: flight starts. */
const takeOff = (dom: HTMLElement) =>
  dom.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true, cancelable: true }));
const land = (dom: HTMLElement) =>
  dom.dispatchEvent(new PointerEvent('pointerup', { button: 2, bubbles: true }));
const press = (code: string, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the keyboard belongs to the fly, and only to the fly', () => {
  it('ignores a key pressed BEFORE the flight: we never take off already moving', () => {
    const { dom, camera, fly } = setup();
    press('KeyW'); // held outside the flight: nothing moves, and nothing must accumulate
    takeOff(dom);
    fly.update(1);
    expect(camera.position.z).toBe(5);
    fly.dispose();
  });

  it('moves forward when the key is pressed DURING the flight', () => {
    const { dom, camera, fly } = setup();
    takeOff(dom);
    press('KeyW');
    fly.update(1);
    expect(camera.position.z).toBeLessThan(5);
    fly.dispose();
  });

  it('ignores a key typed in an input field, even during the flight', () => {
    const { dom, camera, fly } = setup();
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    takeOff(dom);
    press('KeyW', field);
    fly.update(1);
    expect(camera.position.z).toBe(5);
    fly.dispose();
  });

  it('names the flight keys in a single place', () => {
    expect(isFlyMoveCode('KeyS')).toBe(true);
    expect(isFlyMoveCode('KeyX')).toBe(false);
    expect(Object.keys(FLY_MOVE_MAPPING).every(isFlyMoveCode)).toBe(true);
  });
});

describe('the orbit is held by a counter, not by a boolean', () => {
  it('freezes the orbit on take-off and restores it on landing', () => {
    const { dom, controls, fly } = setup();
    takeOff(dom);
    expect(controls.enabled).toBe(false);
    expect(orbitInhibitors(controls)).toEqual(['fly']);
    land(dom);
    expect(controls.enabled).toBe(true);
    fly.dispose();
  });

  it('does not restore the orbit when a gizmo releases its own MID-FLIGHT', () => {
    const { dom, controls, fly } = setup();
    takeOff(dom);
    const gizmo = inhibitOrbit(controls, 'gizmo-drag');
    gizmo();
    expect(controls.enabled).toBe(false); // the original defect restored the orbit here
    land(dom);
    expect(controls.enabled).toBe(true);
    fly.dispose();
  });

  it('releases its token on `dispose`, while flying', () => {
    const { dom, controls, fly } = setup();
    takeOff(dom);
    fly.dispose();
    expect(controls.enabled).toBe(true);
    expect(orbitInhibitors(controls)).toEqual([]);
  });
});

/**
 * The tilt (roll from the Camera panel) does not survive the flight on its own: outside the
 * flight it is carried by the camera orientation (the orbit recomposes it on every turn, see
 * `cameraRoll`), and during the flight the composed pose must carry it. With real three.js: the
 * fly pose does carry the roll, and the resulting orientation is the one `lookAt` would produce
 * with the `up` from `applyRoll`, so nothing jumps on landing.
 */
describe('the tilt is part of the fly pose', () => {
  /** Roll actually displayed by a camera (the one the flight reads). */
  const shownRoll = (camera: three.PerspectiveCamera) => rollFromCamera(three, camera);

  /** Camera posed by the orbit with a tilt: exactly the state before the right click. */
  const tiltedCamera = (roll: number) => {
    const camera = new three.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    camera.position.set(0, 1, 5);
    applyRoll(three, camera, new three.Vector3(0, -1, -5), roll);
    camera.lookAt(0, 0, 0);
    return camera;
  };

  it('composes the roll as `z = -roll` (YXZ order)', () => {
    expect(flyLookEuler({ x: 0, y: 0 }, { x: 0, y: 0 }, 0.4).z).toBeCloseTo(-0.4);
    expect(flyLookEuler({ x: 0, y: 0 }, { x: 0, y: 0 }, 0).z).toBe(0);
    // Non-finite mouse movement (synthetic pointers): the pose must not turn into NaN.
    const pose = flyLookEuler({ x: 0.2, y: 0.3 }, { x: Number.NaN, y: Number.NaN }, Number.NaN);
    expect(pose).toEqual({ x: 0.2, y: 0.3, z: 0 });
  });

  it('keeps the displayed tilt after a mouse movement (it used to drop to zero)', () => {
    const roll = (30 * Math.PI) / 180;
    const camera = tiltedCamera(roll);
    expect(shownRoll(camera)).toBeCloseTo(roll, 4); // starting pose: the tilt is there
    // What `onPointerMove` does: re-read the tilt, compose the pose, realign `up`.
    const euler = new three.Euler(0, 0, 0, 'YXZ').setFromQuaternion(camera.quaternion);
    const look = flyLookEuler(euler, { x: 40, y: 12 }, rollFromCamera(three, camera));
    euler.set(look.x, look.y, look.z, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    expect(shownRoll(camera)).toBeCloseTo(roll, 4);
  });

  it('reads the tilt from the ORIENTATION, with `up` left flat by the orbit', () => {
    const roll = 0.35;
    const camera = tiltedCamera(roll);
    // Real state before the right click: the orbit loop carries the tilt in the orientation and
    // leaves `up` flat. Reading it from `up` returned 0, and the flight started with a level horizon.
    camera.up.set(0, 1, 0);
    expect(rollFromCamera(three, camera)).toBeCloseTo(roll, 4);
    const euler = new three.Euler(0, 0, 0, 'YXZ').setFromQuaternion(camera.quaternion);
    const look = flyLookEuler(euler, { x: 25, y: -10 }, rollFromCamera(three, camera));
    euler.set(look.x, look.y, look.z, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    expect(shownRoll(camera)).toBeCloseTo(roll, 4);
  });

  it('realigns `up`: landing (the orbit lookAt) does not make the view jump', () => {
    const roll = -0.5;
    const camera = tiltedCamera(roll);
    const euler = new three.Euler(0, 0, 0, 'YXZ').setFromQuaternion(camera.quaternion);
    const look = flyLookEuler(euler, { x: -80, y: 30 }, roll);
    euler.set(look.x, look.y, look.z, 'YXZ');
    camera.quaternion.setFromEuler(euler);
    const flown = camera.quaternion.clone();
    // End of flight: `up` realigned with the new view, then lookAt on the reprojected target.
    const forward = new three.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    applyRoll(three, camera, forward, roll);
    camera.lookAt(camera.position.clone().addScaledVector(forward, 4));
    expect(camera.quaternion.angleTo(flown)).toBeLessThan(1e-3);
  });
});
