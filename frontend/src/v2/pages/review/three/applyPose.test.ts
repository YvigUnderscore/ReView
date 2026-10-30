// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyPoseToCamera } from './applyPose';

describe('applyPoseToCamera — pose on a free camera (PiP layout)', () => {
  it('positions the camera and orients it towards the target', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    applyPoseToCamera(THREE, camera, {
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      fov: 35,
    });
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
    expect(camera.fov).toBe(35);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeCloseTo(-1); // looks towards -Z (the target)
  });

  it('applies the roll (up tilted) without deflecting the view direction', () => {
    const camera = new THREE.PerspectiveCamera();
    applyPoseToCamera(THREE, camera, {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      roll: Math.PI / 2,
    });
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeCloseTo(-1); // direction unchanged
    expect(Math.abs(camera.up.x)).toBeCloseTo(1); // up tilted (roll)
  });
});
