// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { captureSplatCamera, restoreSplatCamera } from './splatCameraState';

// Like OrbitControls: update() orients the camera towards the target (lookAt, current up).
const makeControls = (camera: THREE.PerspectiveCamera, target: THREE.Vector3) =>
  ({ target, update: () => camera.lookAt(target) }) as never;

describe('splatCameraState — capture/restore with tilt (roll)', () => {
  it('captures position/target/fov and omits the roll if the horizon is level', () => {
    const camera = new THREE.PerspectiveCamera(55, 1.5, 0.1, 100);
    camera.position.set(0, 0, 5);
    const controls = makeControls(camera, new THREE.Vector3(0, 0, 0));
    const cam = captureSplatCamera(THREE, camera, controls);
    expect(cam.position).toEqual({ x: 0, y: 0, z: 5 });
    expect(cam.target.x).toBeCloseTo(0);
    expect(cam.target.y).toBeCloseTo(0);
    expect(cam.target.z).toBeCloseTo(0);
    expect(cam.fov).toBe(55);
    expect(cam.roll).toBeUndefined(); // default up: no roll
  });

  it('flight (controls frozen): the capture follows the actual rotation of the camera', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 5);
    // Stale orbit target (the flight only resets it on release): at (0,0,0).
    const controls = makeControls(camera, new THREE.Vector3(0, 0, 0));
    // Gaze turned 90° to the left (quaternion only, like flyControls).
    camera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'YXZ'));
    const cam = captureSplatCamera(THREE, camera, controls);
    // The captured target is reprojected in front of the camera (orbit distance = 5): at -X.
    expect(cam.target.x).toBeCloseTo(-5);
    expect(cam.target.y).toBeCloseTo(0);
    expect(cam.target.z).toBeCloseTo(5);
  });

  it('restores position/target/fov and applies the roll (tilted up)', () => {
    const camera = new THREE.PerspectiveCamera();
    const controls = makeControls(camera, new THREE.Vector3());
    restoreSplatCamera(THREE, camera, controls, {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      fov: 40,
      roll: Math.PI / 2,
    });
    expect(camera.position.z).toBe(5);
    expect(camera.fov).toBe(40);
    expect(Math.abs(camera.up.x)).toBeCloseTo(1); // roll π/2: up ≈ ±X
  });

  it('roll round-trip (capture after restore)', () => {
    const camera = new THREE.PerspectiveCamera();
    const controls = makeControls(camera, new THREE.Vector3());
    restoreSplatCamera(THREE, camera, controls, {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      roll: 0.6,
    });
    expect(captureSplatCamera(THREE, camera, controls).roll).toBeCloseTo(0.6);
  });

  it('unusable state: no-op', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 1, 1);
    restoreSplatCamera(THREE, camera, makeControls(camera, new THREE.Vector3()), null);
    expect(camera.position.toArray()).toEqual([1, 1, 1]);
  });
});
