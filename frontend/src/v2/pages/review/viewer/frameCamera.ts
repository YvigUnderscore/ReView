// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Frames the camera on a bounding sphere while keeping the current view direction (shortcut
 * `F`: frame the selection or object without reorienting). Adjusts near/far and the
 * OrbitControls target. Returns `false` if the sphere is degenerate. Shared 3D/splat (Phase 17,
 * extracted from `splat/scene/frameCamera`).
 *
 * Args:
 *     camera: Camera to reposition.
 *     controls: OrbitControls whose target is re-centred.
 *     center: Centre of the bounding sphere.
 *     radius: Radius of the bounding sphere.
 *
 * Returns:
 *     Whether the camera was framed.
 */
export function frameCameraToSphere(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  center: THREE.Vector3,
  radius: number,
): boolean {
  if (!Number.isFinite(radius) || radius <= 0) return false;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
  const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.2;
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
  dir.normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(radius / 100, 0.001);
  camera.far = Math.max(camera.far, radius * 100);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  return true;
}

/** World bounding sphere of an object (bbox → sphere), or null if degenerate. */
export function objectBoundingSphere(
  three: typeof import('three'),
  object: THREE.Object3D,
): { center: THREE.Vector3; radius: number } | null {
  const box = new three.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new three.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return null;
  return { center: sphere.center, radius: sphere.radius };
}

/** World bounding sphere of several objects — `F` framing of a multi-mesh prim (46.I). */
export function objectsBoundingSphere(
  three: typeof import('three'),
  objects: readonly THREE.Object3D[],
): { center: THREE.Vector3; radius: number } | null {
  const box = new three.Box3();
  for (const object of objects) box.expandByObject(object);
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new three.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return null;
  return { center: sphere.center, radius: sphere.radius };
}
