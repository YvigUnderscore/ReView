// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeProjector, paintHandle, raycastSurface, type PaintSceneHandle } from './surfaceRay';

/**
 * The cloud is replaced by a **plane**: `SplatMesh.raycast` is the only thing the brush asks of it,
 * and a plane satisfies it exactly as a real surface would. Nothing here touches the GPU:
 * `Raycaster`, `Matrix4` and the camera are pure computation.
 *
 * Since lot 13 the brush also serves the 3D model: the second set of cases describes the
 * difference, a cloud answering the ray itself while a model holds its geometry in its children.
 */
const VIEWPORT = { width: 200, height: 200 };

function fakeHandle(meshPosition = new THREE.Vector3(), planeZ = 0) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const mesh = new THREE.Object3D();
  mesh.position.copy(meshPosition);
  mesh.updateMatrixWorld(true);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
  Object.assign(mesh, {
    raycast: (
      raycaster: THREE.Raycaster,
      hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[],
    ) => {
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      hits.push({ distance: raycaster.ray.origin.distanceTo(point), point, object: mesh });
    },
  });
  return { THREE, camera, mesh } as unknown as PaintSceneHandle;
}

/** Object whose raycast returns a point at `z`, like a flat surface. */
function planeAt(z: number, name: string) {
  const object = new THREE.Object3D();
  object.name = name;
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  Object.assign(object, {
    raycast: (
      raycaster: THREE.Raycaster,
      hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[],
    ) => {
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      hits.push({ distance: raycaster.ray.origin.distanceTo(point), point, object });
    },
  });
  return object;
}

/**
 * Handle of a **model**: `mesh` is the root group (the space of the strokes, as on the splat side)
 * and `modelObject` the object of the loaded model: it is that one, and that one alone, that the
 * ray queries.
 */
function fakeModelHandle() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const mesh = new THREE.Object3D();
  const modelObject = new THREE.Object3D();
  mesh.add(modelObject);
  mesh.updateMatrixWorld(true);
  return { THREE, camera, mesh, modelObject } as unknown as PaintSceneHandle;
}

describe('raycastSurface', () => {
  it('hits the surface at the centre of the view and returns the point in world AND object space', () => {
    const sample = raycastSurface(fakeHandle(), [100, 100], VIEWPORT, 6);
    expect(sample).not.toBeNull();
    expect(sample!.world[0]).toBeCloseTo(0, 5);
    expect(sample!.world[1]).toBeCloseTo(0, 5);
    expect(sample!.world[2]).toBeCloseTo(0, 5);
    expect(sample!.depth).toBeCloseTo(10, 5);
    expect(sample!.screenStep).toBe(6);
  });

  it('brings the point back into object space when the media is transformed', () => {
    // Mesh offset by 3 in x: the world point (0,0,0) is (-3,0,0) in object space.
    const sample = raycastSurface(fakeHandle(new THREE.Vector3(3, 0, 0)), [100, 100], VIEWPORT, 0);
    expect(sample!.world[0]).toBeCloseTo(0, 5);
    expect(sample!.object[0]).toBeCloseTo(-3, 5);
  });

  it('orients the approximate normal towards the camera, in object space', () => {
    const sample = raycastSurface(fakeHandle(), [100, 100], VIEWPORT, 0);
    expect(sample!.toCamera[2]).toBeCloseTo(1, 5);
    expect(Math.hypot(...sample!.toCamera)).toBeCloseTo(1, 5);
  });

  it('returns null when the ray hits nothing (the stroke stops there)', () => {
    const handle = fakeHandle();
    // Plane parallel to the central ray: no intersection.
    Object.assign(handle.mesh, { raycast: () => {} });
    expect(raycastSurface(handle, [100, 100], VIEWPORT, 0)).toBeNull();
  });
});

describe('makeProjector', () => {
  it('projects the centre of the object to the centre of the view', () => {
    const project = makeProjector(fakeHandle(), VIEWPORT);
    const screen = project(0, 0, 0);
    expect(screen).not.toBeNull();
    expect(screen![0]).toBeCloseTo(100, 4);
    expect(screen![1]).toBeCloseTo(100, 4);
  });

  it('goes down the screen when the point goes down in the scene', () => {
    const project = makeProjector(fakeHandle(), VIEWPORT);
    const up = project(0, 1, 0)!;
    const down = project(0, -1, 0)!;
    expect(up[1]).toBeLessThan(100);
    expect(down[1]).toBeGreaterThan(100);
  });

  it('refuses a point behind the camera instead of returning a plausible pixel', () => {
    const project = makeProjector(fakeHandle(), VIEWPORT);
    expect(project(0, 0, 20)).toBeNull();
  });
});

describe('painted surface of a 3D model', () => {
  it('descends into the children of the model: a group does not answer the ray itself', () => {
    const handle = fakeModelHandle();
    // Without a paintable child, the ray hits nothing: the root group has no geometry.
    expect(raycastSurface(handle, [100, 100], VIEWPORT, 0)).toBeNull();
    handle.modelObject!.add(planeAt(0, 'surface'));
    handle.mesh.updateMatrixWorld(true);
    const sample = raycastSurface(handle, [100, 100], VIEWPORT, 0);
    expect(sample).not.toBeNull();
    expect(sample!.depth).toBeCloseTo(10, 5);
  });

  it('ignores what is not the surface of the model: strokes already laid, comparison clones', () => {
    const handle = fakeModelHandle();
    handle.modelObject!.add(planeAt(0, 'surface'));
    // A stroke is a child of the ROOT group, closer to the camera than the surface: without the
    // targeting of `modelObject`, painting over a stroke would snap to the stroke.
    handle.mesh.add(planeAt(5, 'trait'));
    handle.mesh.updateMatrixWorld(true);
    const sample = raycastSurface(handle, [100, 100], VIEWPORT, 0);
    expect(sample!.depth).toBeCloseTo(10, 5);
  });

  it('discards invisible variant options, all baked in the same place', () => {
    const handle = fakeModelHandle();
    const hidden = planeAt(5, 'hidden variant');
    hidden.visible = false;
    handle.modelObject!.add(hidden, planeAt(0, 'visible variant'));
    handle.mesh.updateMatrixWorld(true);
    const sample = raycastSurface(handle, [100, 100], VIEWPORT, 0);
    expect(sample!.depth).toBeCloseTo(10, 5);
  });
});

describe('paintHandle', () => {
  it('refuses a handle without an object to paint: the scene is not mounted', () => {
    expect(paintHandle(null)).toBeNull();
    expect(paintHandle({ THREE } as unknown as PaintSceneHandle)).toBeNull();
    const handle = fakeModelHandle();
    expect(paintHandle(handle)).toBe(handle);
  });
});
