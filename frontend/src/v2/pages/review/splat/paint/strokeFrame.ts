// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import type { PaintSceneHandle } from './surfaceRay';
import type { Vec3 } from './surfaceTrace';

/**
 * Upkeep of a stroke **per rendered frame**, hooked on `onBeforeRender`: Three calls it for each
 * object it draws, so nothing runs when the viewer does not render. This is what keeps two things
 * without a frame subscriber: a subscriber would keep the viewer "busy" permanently and defeat
 * on-demand rendering (cf. `viewer/renderScheduler`).
 *
 *  1. **View resolution** given to the material: without it, the thickness in pixels is wrong
 *     (and changes on resize). `LineSegments2` has its own `onBeforeRender` that takes care of it,
 *     but it sets the viewport in **physical** pixels: on a density-2 screen, a thickness of 3 gave
 *     a stroke of one and a half pixels. So it is replaced by the size in **CSS** pixels, the same
 *     unit as the overlay's cursor ring: what the artist sets in the options bar is then what they
 *     see under the pointer.
 *  2. **Approximate occlusion by normal.** The cloud does not write depth: a stroke painted on the
 *     back face stayed as sharp as those on the front. The stroke's normal (the direction from
 *     which it was painted) is compared to the current camera direction, and it is faded when we
 *     have moved behind. This is an *approximation*: it knows nothing of intermediate surfaces, so
 *     a stroke hidden by a wall of the cloud remains visible as long as it is viewed from the same
 *     side. A true occlusion would require a depth pre-pass of the cloud, which costs one render
 *     pass per frame over millions of splats.
 *
 * Fading rather than hiding is deliberate: the stroke stays findable when orbiting around the
 * cloud, and an invisible object would no longer receive `onBeforeRender`, so it could never come
 * back.
 */

/** Opacity of a stroke seen from the other side. */
export const GHOST_OPACITY = 0.16;
/** Above this: fully visible. Below `FACING_OUT`: fully faded. */
const FACING_IN = 0.1;
const FACING_OUT = -0.2;

/** Opacity of a stroke according to its normal's orientation relative to the camera (pure). */
export function ghostOpacity(facing: number): number {
  if (facing >= FACING_IN) return 1;
  if (facing <= FACING_OUT) return GHOST_OPACITY;
  const k = (facing - FACING_OUT) / (FACING_IN - FACING_OUT);
  return GHOST_OPACITY + k * (1 - GHOST_OPACITY);
}

/**
 * Hooks the per-frame upkeep to the stroke. `normal` absent (strokes from before occlusion):
 * only the resolution is kept up to date, the stroke remains fully visible.
 */
export function attachStrokeFrame(
  line: Line2,
  handle: PaintSceneHandle,
  normal: Vec3 | null,
  center: Vec3,
): void {
  const { THREE, mesh } = handle;
  const size = new THREE.Vector2();
  const cameraObject = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const axis = normal ? new THREE.Vector3(normal[0], normal[1], normal[2]).normalize() : null;
  const origin = new THREE.Vector3(center[0], center[1], center[2]);
  // `LineSegments2` narrows the signature of `onBeforeRender` to its sole `renderer`: we go
  // through the `Object3D` contract, which is the one Three actually calls.
  const object: THREE.Object3D = line;

  object.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getSize(size);
    line.material.resolution.set(size.x, size.y);
    if (!axis) return;
    // Camera position brought back into object space: the stroke lives there, and so does its normal.
    cameraObject
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(inverse.copy(mesh.matrixWorld).invert())
      .sub(origin);
    const length = cameraObject.length();
    if (length < 1e-9) return;
    line.material.opacity = ghostOpacity(axis.dot(cameraObject.divideScalar(length)));
  };
}
