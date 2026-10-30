// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { collectEmbeddedCameras } from './embeddedCameras';

describe('embeddedCameras — glTF cameras adopted as viewpoints (40.C)', () => {
  it('derives position, target and fov in world space', () => {
    const scene = new THREE.Group();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    cam.position.set(0, 0, 5); // looks along -Z by default
    cam.name = 'shotcam';
    scene.add(cam);
    scene.updateMatrixWorld(true);

    const [view] = collectEmbeddedCameras(THREE, [cam], 2);
    expect(view.name).toBe('shotcam');
    expect(view.position.z).toBeCloseTo(5);
    // Target 2 units ahead, along -Z → z = 3.
    expect(view.target.z).toBeCloseTo(3);
    expect(view.fov).toBe(30);
  });

  it('names anonymous cameras by default', () => {
    const cam = new THREE.PerspectiveCamera();
    const [view] = collectEmbeddedCameras(THREE, [cam], 1);
    expect(view.name).toBe('Caméra 1');
  });
});
