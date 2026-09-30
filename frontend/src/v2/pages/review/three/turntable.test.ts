// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { turntableStep } from './turntable';

function setup() {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  // OrbitControls sans DOM réel : on ne touche qu'à `target`.
  const controls = { target: new THREE.Vector3(0, 0, 0) } as unknown as OrbitControls;
  return { camera, controls };
}

describe("turntable — pas d'orbite caméra (39.D)", () => {
  it("rotation Y d'un quart de tour : +Z → +X, rayon préservé", () => {
    const { camera, controls } = setup();
    turntableStep(THREE, camera, controls, 'y', Math.PI / 2);
    expect(camera.position.x).toBeCloseTo(5, 4);
    expect(camera.position.y).toBeCloseTo(0, 4);
    expect(camera.position.z).toBeCloseTo(0, 4);
  });

  it('préserve la distance à la cible sur tout axe', () => {
    const { camera, controls } = setup();
    controls.target.set(1, 2, -1);
    camera.position.set(1, 2, 4); // rayon 5 le long de Z
    turntableStep(THREE, camera, controls, 'x', 0.7);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(5, 4);
  });

  it('oriente la caméra vers la cible', () => {
    const { camera, controls } = setup();
    turntableStep(THREE, camera, controls, 'y', 1.2);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const toTarget = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    expect(fwd.angleTo(toTarget)).toBeCloseTo(0, 3);
  });
});
