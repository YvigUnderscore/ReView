// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { renderWithoutHelpers } from '../../viewer/sceneHelpers';
import { createCameraObject } from './cameraObject';

/**
 * Visual feedback of the camera-object: visible from the free camera in all circumstances, absent
 * from the PiP pass. The rest of the pose is tested in `poseObject.test.ts`.
 */

/** All the object's materials (body, frustum, marker, trajectory). */
function materials(scene: THREE.Scene): THREE.Material[] {
  const out: THREE.Material[] = [];
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) out.push(...(Array.isArray(m) ? m : [m]));
  });
  return out;
}

describe('cameraObject — the artist must see it', () => {
  it('drawn over the scene (inside a splat cloud, depth used to erase it)', () => {
    const scene = new THREE.Scene();
    const obj = createCameraObject(THREE, scene, 1);
    const mats = materials(scene);
    expect(mats.length).toBeGreaterThan(3);
    for (const m of mats) {
      expect(m.depthTest).toBe(false);
      expect(m.depthWrite).toBe(false);
      expect(m.transparent).toBe(true); // transparent pass: after the splats
    }
    obj.dispose();
  });

  it('render order set on EVERY drawn object, not just the group', () => {
    const scene = new THREE.Scene();
    const obj = createCameraObject(THREE, scene, 1);
    const drawn: number[] = [];
    // The body is a `Group`: Three reads `renderOrder` on the rendered object, not on its parent.
    obj.body.traverse((o) => {
      if (o !== obj.body) drawn.push(o.renderOrder);
    });
    expect(drawn.length).toBeGreaterThan(1);
    for (const order of drawn) expect(order).toBe(obj.targetMarker.renderOrder);
    obj.dispose();
  });

  it('declared as a helper object: hidden during the PiP pass, restored afterwards', () => {
    const scene = new THREE.Scene();
    const obj = createCameraObject(THREE, scene, 1);
    obj.setVisible(true);
    obj.setTrajectory([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
    const seen: boolean[] = [];
    renderWithoutHelpers(() => seen.push(obj.body.visible, obj.targetMarker.visible));
    expect(seen).toEqual([false, false]);
    expect(obj.body.visible).toBe(true);
    expect(obj.targetMarker.visible).toBe(true);
    obj.dispose();
  });

  it('once unmounted, it no longer weighs on the PiP pass', () => {
    const scene = new THREE.Scene();
    const obj = createCameraObject(THREE, scene, 1);
    const { body } = obj;
    obj.dispose();
    body.visible = true;
    renderWithoutHelpers(() => expect(body.visible).toBe(true));
  });
});
