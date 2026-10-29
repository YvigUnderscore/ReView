// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { isDrawn } from './sceneOverrideApply';

/**
 * Prim selection on click in the 3D viewer (Phase 46, 46.C).
 *
 * The viewer's left click also drives the orbit, so we only select if the pointer has **not moved**
 * between press and release (beyond a few pixels, it is navigation). Without this guard, any
 * camera rotation would change the selection.
 */

/** Pixel distance beyond which the gesture is navigation, not a click. */
export const CLICK_SLOP_PX = 4;

/** True if the pointer movement stays within the tolerance of a click. */
export function isClickGesture(dx: number, dy: number, slop = CLICK_SLOP_PX): boolean {
  return Math.hypot(dx, dy) <= slop;
}

/** NDC coordinates (−1..1) of a screen point within a given element. */
export function toNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const x = rect.width > 0 ? ((clientX - rect.left) / rect.width) * 2 - 1 : 0;
  const y = rect.height > 0 ? -(((clientY - rect.top) / rect.height) * 2 - 1) : 0;
  // `|| 0` normalizes the `-0` produced by the vertical flip at the exact center.
  return { x: x || 0, y: y || 0 };
}

/**
 * Walks up the hierarchy to the first object carrying a `usdPath`: a click hits a mesh, but it is
 * the prim that carries the manipulable identity.
 */
export function primPathOf(object: THREE.Object3D | null): string | null {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    const path = (node.userData as { usdPath?: unknown } | undefined)?.usdPath;
    if (typeof path === 'string' && path.startsWith('/')) return path;
  }
  return null;
}

/**
 * Prim hit by a ray cast from the camera, or `null`.
 *
 * `resolve` translates the hit object into a prim; the viewer plugs in the scene index there, which
 * has already matched glTF paths to the USD tree. The `primPathOf` fallback serves outside that
 * context.
 */
export function pickPrim(
  three: typeof import('three'),
  camera: THREE.Camera,
  root: THREE.Object3D,
  ndc: { x: number; y: number },
  resolve: (object: THREE.Object3D) => string | null = primPathOf,
): string | null {
  const raycaster = new three.Raycaster();
  raycaster.setFromCamera(new three.Vector2(ndc.x, ndc.y), camera);
  // Three's raycaster does **not** filter invisible objects. Yet the options of a variant are all
  // baked into the same GLB, in the same place: without this filter, the hidden option intercepts
  // the click instead of the one we see, and the selection lands on a prim nobody displays.
  const hit = raycaster.intersectObject(root, true).find((h) => isDrawn(h.object));
  return hit ? resolve(hit.object) : null;
}
