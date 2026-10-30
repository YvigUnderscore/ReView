// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { isDrawn } from '../../three/sceneOverrideApply';
import type { ViewerSceneHandle } from '../../viewer/sceneHandle';
import type { Projector, SurfaceSample, Vec3 } from './surfaceTrace';

/**
 * Bridge between the screen and the painted surface: the only two Three operations of the 3D brush.
 * All the rest of the reasoning (cutting a stroke, normal, choosing the stroke under the eraser) is
 * pure and lives in `surfaceTrace`.
 *
 * The brush no longer knows the cloud: it only reads the **common scene handle**
 * (`viewer/sceneHandle`), which both the splat and the 3D model fill. This is what makes it
 * available on both spatial types (Phase 50, lot 13) without duplicating a line.
 */

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Scene handle carrying an object to paint. `mesh` is optional in the common contract, but
 * required here: it is what gives the **object space** where the stroke is stored, and therefore
 * the transform the stroke will follow.
 */
export type PaintSceneHandle = ViewerSceneHandle & { mesh: THREE.Object3D };

/** Paintable handle, or `null`: the scene is not (yet) mounted. */
export function paintHandle(handle: ViewerSceneHandle | null | undefined): PaintSceneHandle | null {
  return handle?.mesh ? (handle as PaintSceneHandle) : null;
}

/**
 * What the brush ray can hit, and how to query it.
 *
 *  - A **cloud** carries its raycast on the object itself (Spark queries the splats); its children
 *    are only accessories: cut volumes, subset proxy, "points" overlay, strokes already laid. So we
 *    do not descend: painting on a cut box or on a neighbouring stroke makes no sense.
 *  - A **model** holds its geometry in its children: we descend, but from the model's object and
 *    not from the root group, which also carries the clones of the A/B comparison and the strokes,
 *    none of which is the surface being judged.
 *
 * `modelObject` distinguishes the two: only the 3D viewer fills it (cf. `viewer/sceneHandle`).
 * Absent before the model loads, the ray then hits nothing: the brush does not paint, which is
 * exactly what one wants of an empty scene.
 */
function paintTarget(handle: PaintSceneHandle): { object: THREE.Object3D; recursive: boolean } {
  return handle.modelObject
    ? { object: handle.modelObject, recursive: true }
    : { object: handle.mesh, recursive: false };
}

/** Screen coordinates → normalized camera coordinates. */
function toNdc(point: readonly [number, number], viewport: Viewport): [number, number] {
  return [
    (point[0] / Math.max(viewport.width, 1)) * 2 - 1,
    -(point[1] / Math.max(viewport.height, 1)) * 2 + 1,
  ];
}

/**
 * Raycasts a screen point onto the painted surface. `null`: the ray hits nothing (sky, hole,
 * edge of the cloud), and the caller deduces that the stroke stops there.
 *
 * Invisible objects are discarded (`isDrawn`, the same rule as prim selection): the options of a
 * USD variant are all baked at the same place in the GLB, and without this filter the ray would
 * hit the one nobody sees.
 */
export function raycastSurface(
  handle: PaintSceneHandle,
  point: readonly [number, number],
  viewport: Viewport,
  screenStep: number,
): SurfaceSample | null {
  const { THREE, camera, mesh } = handle;
  const raycaster = new THREE.Raycaster();
  const [nx, ny] = toNdc(point, viewport);
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const target = paintTarget(handle);
  // `intersectObject` already sorts by increasing distance; it calls the object's raycast, then,
  // if asked, descends the hierarchy.
  const hit = raycaster.intersectObject(target.object, target.recursive).find((h) => isDrawn(h.object));
  if (!hit) return null;
  const world = hit.point.clone();
  mesh.updateMatrixWorld();
  const inverse = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const object = world.clone().applyMatrix4(inverse);
  const cameraObject = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const depth = cameraObject.distanceTo(world);
  const toCamera = cameraObject.applyMatrix4(inverse).sub(object);
  const length = toCamera.length();
  if (length > 1e-9) toCamera.divideScalar(length);
  const asVec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
  return { world: asVec(world), object: asVec(object), depth, screenStep, toCamera: asVec(toCamera) };
}

/**
 * Projector from object space to view pixels, frozen on the current camera pose. Returns `null`
 * for a point behind the camera: projecting it would give a plausible but wrong pixel.
 */
export function makeProjector(handle: PaintSceneHandle, viewport: Viewport): Projector {
  const { THREE, camera, mesh } = handle;
  mesh.updateMatrixWorld();
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
  const point = new THREE.Vector3();
  return (x, y, z) => {
    point.set(x, y, z).applyMatrix4(matrix);
    // Camera space: visible points have a negative z (the camera looks towards -z).
    if (point.z > -1e-6) return null;
    // `applyMatrix4` does the perspective division: the point comes out in normalized coordinates.
    point.applyMatrix4(camera.projectionMatrix);
    return [(point.x * 0.5 + 0.5) * viewport.width, (point.y * -0.5 + 0.5) * viewport.height];
  };
}
