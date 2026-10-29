// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { turntableStep } from './turntable';

function setup() {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  // OrbitControls without a real DOM: we only touch `target`.
  const controls = { target: new THREE.Vector3(0, 0, 0) } as unknown as OrbitControls;
  return { camera, controls };
}

describe('turntable — no camera orbit (39.D)', () => {
  it('Y rotation by a quarter turn: +Z → +X, radius preserved', () => {
    const { camera, controls } = setup();
    turntableStep(THREE, camera, controls, 'y', Math.PI / 2);
    expect(camera.position.x).toBeCloseTo(5, 4);
    expect(camera.position.y).toBeCloseTo(0, 4);
    expect(camera.position.z).toBeCloseTo(0, 4);
  });

  it('preserves the distance to the target on every axis', () => {
    const { camera, controls } = setup();
    controls.target.set(1, 2, -1);
    camera.position.set(1, 2, 4); // radius 5 along Z
    turntableStep(THREE, camera, controls, 'x', 0.7);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(5, 4);
  });

  it('orients the camera toward the target', () => {
    const { camera, controls } = setup();
    turntableStep(THREE, camera, controls, 'y', 1.2);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const toTarget = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    expect(fwd.angleTo(toTarget)).toBeCloseTo(0, 3);
  });
});
