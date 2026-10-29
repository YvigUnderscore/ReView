// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyRoll, rollFromCamera, rollFromUp, rollOrientation, updateOrbitKeepingRoll } from './cameraRoll';

describe('cameraRoll — tilt via camera.up (layout mode)', () => {
  it('roll 0: up = +Y (level horizon) for a horizontal view', () => {
    const camera = new THREE.PerspectiveCamera();
    applyRoll(THREE, camera, new THREE.Vector3(0, 0, -1), 0);
    expect(camera.up.x).toBeCloseTo(0);
    expect(camera.up.y).toBeCloseTo(1);
    expect(camera.up.z).toBeCloseTo(0);
  });

  it('roll π/2: up tilts to ±X (rotation around the view)', () => {
    const camera = new THREE.PerspectiveCamera();
    applyRoll(THREE, camera, new THREE.Vector3(0, 0, -1), Math.PI / 2);
    expect(Math.abs(camera.up.x)).toBeCloseTo(1);
    expect(camera.up.y).toBeCloseTo(0);
  });

  it('round-trip: rollFromUp recovers the applied roll', () => {
    const camera = new THREE.PerspectiveCamera();
    const forward = new THREE.Vector3(1, -0.5, -1);
    for (const roll of [0, 0.3, -0.8, 1.2]) {
      applyRoll(THREE, camera, forward, roll);
      expect(rollFromUp(THREE, forward, camera.up)).toBeCloseTo(roll);
    }
  });

  it('vertical view: non-degenerate up (tilts to +Z)', () => {
    const camera = new THREE.PerspectiveCamera();
    applyRoll(THREE, camera, new THREE.Vector3(0, -1, 0), 0);
    expect(camera.up.length()).toBeCloseTo(1);
  });

  it('roll 0: restores the world up whatever the view axis (Phase 26, tilt fix)', () => {
    const camera = new THREE.PerspectiveCamera();
    // A non-zero roll froze a tilted up; returning to 0 must give (0,1,0), not a projected up.
    const forward = new THREE.Vector3(1, -0.5, -1);
    applyRoll(THREE, camera, forward, 0.7);
    applyRoll(THREE, camera, forward, 0);
    expect(camera.up.x).toBe(0);
    expect(camera.up.y).toBe(1);
    expect(camera.up.z).toBe(0);
  });
});

/**
 * Orbit: as far as the tilt is concerned, `OrbitControls.update()` does only one thing:
 * `object.lookAt(target)` after repositioning the position on its sphere. The fake controller
 * below reproduces exactly these two steps; that is enough to observe the drift.
 */
function fakeControls(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
  return { target, update: () => camera.lookAt(target) };
}

/** Rotates the camera around its target (what a left-button drag produces). */
function orbit(camera: THREE.PerspectiveCamera, target: THREE.Vector3, angle: number): void {
  const offset = camera.position
    .clone()
    .sub(target)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  camera.position.copy(target).add(offset);
}

describe('cameraRoll — the tilt through the orbit', () => {
  const setup = (roll: number) => {
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Vector3(0, 0, 0);
    camera.position.set(0, 2, 6);
    const controls = fakeControls(camera, target);
    applyRoll(THREE, camera, target.clone().sub(camera.position), roll);
    controls.update();
    return { camera, target, controls };
  };

  it('the `up` frozen by `applyRoll` makes the tilt DRIFT as soon as one orbits (the default)', () => {
    const { camera, target, controls } = setup(0.5);
    expect(rollFromCamera(THREE, camera)).toBeCloseTo(0.5);
    orbit(camera, target, Math.PI / 3);
    controls.update(); // bare orbit: `lookAt` re-reads the tilted up, now obsolete
    expect(Math.abs(rollFromCamera(THREE, camera) - 0.5)).toBeGreaterThan(0.05);
  });

  it('`updateOrbitKeepingRoll` keeps the set tilt, quarter turn after quarter turn', () => {
    const { camera, target, controls } = setup(0.5);
    for (let i = 0; i < 8; i++) {
      orbit(camera, target, Math.PI / 4);
      updateOrbitKeepingRoll(THREE, camera, controls);
      expect(rollFromCamera(THREE, camera)).toBeCloseTo(0.5);
    }
    // And the up is back to flat: it is the orientation that carries the tilt, no longer a world vector.
    expect(camera.up.y).toBeCloseTo(1);
  });

  it('zero tilt: the orbit stays exactly as before (no recomposition)', () => {
    const { camera, target, controls } = setup(0);
    orbit(camera, target, 0.7);
    updateOrbitKeepingRoll(THREE, camera, controls);
    const kept = camera.quaternion.clone();
    camera.lookAt(target); // what `controls.update()` alone would do
    expect(kept.angleTo(camera.quaternion)).toBeCloseTo(0);
  });

  it('camera coinciding with its target: bare orbit, no NaN', () => {
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Vector3(1, 1, 1);
    camera.position.copy(target);
    applyRoll(THREE, camera, new THREE.Vector3(0, 0, -1), 0.4);
    updateOrbitKeepingRoll(THREE, camera, fakeControls(camera, target));
    expect(Number.isFinite(camera.quaternion.x)).toBe(true);
    expect(Number.isFinite(camera.up.y)).toBe(true);
  });
});

describe('cameraRoll — roll in the orientation', () => {
  it('`rollOrientation` after a flat `lookAt` = `lookAt` with the `up` of `applyRoll`', () => {
    const target = new THREE.Vector3(2, -1, 0);
    for (const roll of [0.3, -0.8, 1.2]) {
      const viaUp = new THREE.PerspectiveCamera();
      viaUp.position.set(-3, 4, 5);
      applyRoll(THREE, viaUp, target.clone().sub(viaUp.position), roll);
      viaUp.lookAt(target);

      const viaOrientation = new THREE.PerspectiveCamera();
      viaOrientation.position.copy(viaUp.position);
      viaOrientation.lookAt(target); // up = +Y: orientation without roll
      rollOrientation(THREE, viaOrientation, roll);

      expect(viaUp.quaternion.angleTo(viaOrientation.quaternion)).toBeCloseTo(0);
    }
  });

  it('`rollFromCamera` reads the displayed tilt, whether the roll comes from the `up` or the orientation', () => {
    const target = new THREE.Vector3(0, 0, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(4, 1, -2);
    camera.lookAt(target);
    rollOrientation(THREE, camera, -0.6);
    expect(rollFromCamera(THREE, camera)).toBeCloseTo(-0.6);
  });

  it('negligible roll: the orientation is not touched', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.lookAt(new THREE.Vector3(1, 0, -3));
    const before = camera.quaternion.clone();
    rollOrientation(THREE, camera, 1e-9);
    rollOrientation(THREE, camera, Number.NaN);
    expect(camera.quaternion.equals(before)).toBe(true);
  });
});
