// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { GHOST_OPACITY, attachStrokeFrame, ghostOpacity } from './strokeFrame';
import type { PaintSceneHandle } from './surfaceRay';

/** Per-frame upkeep, called with the minimum it actually uses. */
type Upkeep = (
  renderer: { getSize: (target: THREE.Vector2) => THREE.Vector2 },
  scene: unknown,
  camera: THREE.Camera,
) => void;

function fakeLine() {
  const line = {
    material: { resolution: new THREE.Vector2(), opacity: 1 },
    onBeforeRender: () => {},
  };
  return line as unknown as Line2 & { material: { resolution: THREE.Vector2; opacity: number } };
}

function fakeHandle(meshPosition: THREE.Vector3 = new THREE.Vector3()) {
  const mesh = new THREE.Object3D();
  mesh.position.copy(meshPosition);
  mesh.updateMatrixWorld(true);
  return { THREE, mesh } as unknown as PaintSceneHandle;
}

const renderer = { getSize: (target: THREE.Vector2) => target.set(1280, 720) };

function cameraAt(x: number, y: number, z: number) {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  camera.position.set(x, y, z);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('ghostOpacity', () => {
  it('full opacity facing the stroke, ghosted behind, ramps between the two', () => {
    expect(ghostOpacity(1)).toBe(1);
    expect(ghostOpacity(0.1)).toBe(1);
    expect(ghostOpacity(-0.2)).toBe(GHOST_OPACITY);
    expect(ghostOpacity(-1)).toBe(GHOST_OPACITY);
    const middle = ghostOpacity(-0.05);
    expect(middle).toBeGreaterThan(GHOST_OPACITY);
    expect(middle).toBeLessThan(1);
    expect(middle).toBeCloseTo(GHOST_OPACITY + 0.5 * (1 - GHOST_OPACITY), 6);
  });

  it('increases without going back down over the whole ramp', () => {
    let previous = -1;
    for (let facing = -0.3; facing <= 0.2; facing += 0.01) {
      const value = ghostOpacity(facing);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('attachStrokeFrame', () => {
  it('gives the material the view size: without it, the thickness in pixels is wrong', () => {
    const line = fakeLine();
    attachStrokeFrame(line, fakeHandle(), null, [0, 0, 0]);
    (line.onBeforeRender as unknown as Upkeep)(renderer, null, cameraAt(0, 0, 10));
    expect(line.material.resolution.x).toBe(1280);
    expect(line.material.resolution.y).toBe(720);
  });

  it('leaves a stroke without a normal fully visible (strokes from before occlusion)', () => {
    const line = fakeLine();
    attachStrokeFrame(line, fakeHandle(), null, [0, 0, 0]);
    (line.onBeforeRender as unknown as Upkeep)(renderer, null, cameraAt(0, 0, -10));
    expect(line.material.opacity).toBe(1);
  });

  it('fades the stroke when the camera moves behind the painted face', () => {
    const line = fakeLine();
    // Stroke painted from +z: its object normal points towards +z.
    attachStrokeFrame(line, fakeHandle(), [0, 0, 1], [0, 0, 0]);
    const upkeep = line.onBeforeRender as unknown as Upkeep;
    upkeep(renderer, null, cameraAt(0, 0, 10));
    expect(line.material.opacity).toBe(1);
    upkeep(renderer, null, cameraAt(0, 0, -10));
    expect(line.material.opacity).toBe(GHOST_OPACITY);
  });

  it('measures in object space: the media transform does not invert the occlusion', () => {
    const line = fakeLine();
    // The mesh is moved by 100 in x; the stroke, for its part, lives in object space at (0,0,0).
    attachStrokeFrame(line, fakeHandle(new THREE.Vector3(100, 0, 0)), [0, 0, 1], [0, 0, 0]);
    const upkeep = line.onBeforeRender as unknown as Upkeep;
    upkeep(renderer, null, cameraAt(100, 0, 10));
    expect(line.material.opacity).toBe(1);
    upkeep(renderer, null, cameraAt(100, 0, -10));
    expect(line.material.opacity).toBe(GHOST_OPACITY);
  });
});
