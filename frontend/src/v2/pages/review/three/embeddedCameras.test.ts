// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { collectEmbeddedCameras } from './embeddedCameras';

describe('embeddedCameras — caméras glTF adoptées comme points de vue (40.C)', () => {
  it('dérive position/cible/fov dans l’espace monde', () => {
    const scene = new THREE.Group();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    cam.position.set(0, 0, 5); // regarde -Z par défaut
    cam.name = 'shotcam';
    scene.add(cam);
    scene.updateMatrixWorld(true);

    const [view] = collectEmbeddedCameras(THREE, [cam], 2);
    expect(view.name).toBe('shotcam');
    expect(view.position.z).toBeCloseTo(5);
    // Cible 2 unités devant, le long de -Z → z = 3.
    expect(view.target.z).toBeCloseTo(3);
    expect(view.fov).toBe(30);
  });

  it('nomme par défaut les caméras anonymes', () => {
    const cam = new THREE.PerspectiveCamera();
    const [view] = collectEmbeddedCameras(THREE, [cam], 1);
    expect(view.name).toBe('Caméra 1');
  });
});
