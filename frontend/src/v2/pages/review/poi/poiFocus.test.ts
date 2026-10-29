// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { focusObjectPoint, poiFocusRadius, POI_FOCUS_RATIO } from './poiFocus';

/** OrbitControls reduced to what the framing reads and writes: its target and its `update`. */
function controlsStub() {
  let updates = 0;
  const controls = {
    target: new THREE.Vector3(0, 0, 0),
    update: () => {
      updates += 1;
    },
  };
  return { controls: controls as unknown as OrbitControls, target: controls.target, calls: () => updates };
}

function rig() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  const object = new THREE.Group();
  return { camera, object, ...controlsStub() };
}

describe('poiFocusRadius — a point has no size, the framing gives it one', () => {
  it('takes a fraction of the scene, never zero', () => {
    expect(poiFocusRadius(10)).toBeCloseTo(10 * POI_FOCUS_RATIO);
    expect(poiFocusRadius(0)).toBeGreaterThan(0);
    expect(poiFocusRadius(Number.NaN)).toBeGreaterThan(0);
  });
});

describe('focusObjectPoint — the clicked number brings the camera back to its point', () => {
  it('frames the point, keeping the view direction', () => {
    const { camera, object, controls, target } = rig();
    const ok = focusObjectPoint({
      three: THREE,
      camera,
      controls,
      object,
      point: { position: '2 1 0', normal: '0 0 1', space: 'object' },
      sceneRadius: 4,
    });
    expect(ok).toBe(true);
    expect(target.toArray()).toEqual([2, 1, 0]);
    // The camera stays on the same side (it was looking from +Z) and comes closer to the point.
    expect(camera.position.z).toBeGreaterThan(0);
    expect(camera.position.x).toBeCloseTo(2);
  });

  it("applies the object's world matrix: replay is valid for every viewer", () => {
    const { camera, object, controls, target } = rig();
    object.position.set(5, 0, 0);
    object.updateMatrixWorld(true);
    focusObjectPoint({
      three: THREE,
      camera,
      controls,
      object,
      point: { position: '2 0 0', normal: '0 0 1', space: 'object' },
      sceneRadius: 4,
    });
    // Local point 2 + object shifted by 5 → the framing aims at 7 in world space.
    expect(target.x).toBeCloseTo(7);
  });

  it('leaves a point in WORLD space where it is (annotation predating object space)', () => {
    const { camera, object, controls, target } = rig();
    object.position.set(5, 0, 0);
    object.updateMatrixWorld(true);
    focusObjectPoint({
      three: THREE,
      camera,
      controls,
      object,
      point: { position: '2 0 0', normal: '0 0 1' },
      sceneRadius: 4,
    });
    expect(target.x).toBeCloseTo(2);
  });

  it('moves nothing if the position is unreadable', () => {
    const { camera, object, controls, target, calls } = rig();
    const ok = focusObjectPoint({
      three: THREE,
      camera,
      controls,
      object,
      point: { position: 'x y z', normal: '0 0 1' },
      sceneRadius: 4,
    });
    expect(ok).toBe(false);
    expect(target.toArray()).toEqual([0, 0, 0]);
    expect(calls()).toBe(0);
  });
});
