// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SplatMesh } from '@sparkjsdev/spark';
import { visibleLocalBox } from './visibleBounds';

/**
 * Automatic camera framing (10.G): positions the camera and the OrbitControls target on the
 * splat's bbox, so that the bounding sphere fits in the most constrained of the FOVs (portrait
 * included). Returns `true` if the framing could be computed (valid bbox), otherwise `false`
 * (falls back to the default position). Extracted from `useSplat`: isolated scene logic, without
 * React state. The generic framing `frameCameraToSphere` (F shortcut) lives in `viewer/frameCamera`.
 */
export function frameCameraToMesh(
  THREE: typeof import('three'),
  mesh: SplatMesh,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): boolean {
  try {
    // Visible splat centres only (11.D): after deletion, H reframes on what remains; falls back
    // to the full Spark bbox if the data is unavailable. Converted to world space (11.E): the
    // orientation flip carried by the parent group (and the mesh's user transform) moves the
    // real centre to frame.
    const box = visibleLocalBox(THREE, mesh);
    if (!box) return false;
    mesh.updateWorldMatrix(true, false); // ancestors included (flip pivot not yet rendered)
    box.applyMatrix4(mesh.matrixWorld);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    if (!Number.isFinite(radius) || radius <= 0) return false;
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.2;
    camera.position.copy(center).add(new THREE.Vector3(0, 0, dist));
    camera.near = Math.max(radius / 100, 0.001);
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    return true;
  } catch {
    // bbox unavailable: keep the default position (0,0,3).
    return false;
  }
}
