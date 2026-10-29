// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatSceneHandle } from '../../useSplat';
import { combineSelection, type SelectCombine } from './shapes2d';

/**
 * Surface brush (10.G-V3; Phase 28): selects the splats under the brush disc **and** close to
 * the depth of the targeted surface. A raycast at the centre of the brush gives the surface point;
 * only splats whose seen depth falls within a band around this point are taken (splats traversed
 * far behind are ignored). Planned fallback: Spark's `Readback` API reads by **splat index**,
 * not per pixel, so no usable per-pixel depth picking as it stands; `SplatMesh.raycast` provides
 * the surface and the band does the sorting.
 */

/** Fraction of the touched depth used as the half-width of the surface band (Phase 28). */
export const DEPTH_BAND_FRACTION = 0.03;

/**
 * Half-thickness (view space) of the surface band: **fixed** relative to the touched depth,
 * **independent of the brush radius** (Phase 28). A large brush therefore no longer digs in
 * depth ("drilling" fixed): it widens the footprint on screen, not the thickness.
 */
export function depthBand(hitViewZ: number, fraction = DEPTH_BAND_FRACTION): number {
  return Math.max(Math.abs(hitViewZ) * fraction, 1e-6);
}

/**
 * Pure: indices whose projection falls in the brush's screen disc AND whose seen depth
 * (clip w, for a perspective camera) lies within the surface band.
 */
export function collectBrushHits(
  e: ArrayLike<number>,
  centers: Float32Array,
  isHidden: (index: number) => boolean,
  viewport: { width: number; height: number },
  brush: { x: number; y: number; radiusPx: number },
  band: { viewZ: number; halfDepth: number },
): number[] {
  const { width, height } = viewport;
  const r2 = brush.radiusPx * brush.radiusPx;
  const zMin = band.viewZ - band.halfDepth;
  const zMax = band.viewZ + band.halfDepth;
  const hits: number[] = [];
  const n = centers.length / 3;
  for (let i = 0; i < n; i++) {
    if (isHidden(i)) continue;
    const x = centers[3 * i];
    const y = centers[3 * i + 1];
    const z = centers[3 * i + 2];
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 0) continue; // behind the camera
    if (w < zMin || w > zMax) continue; // outside the surface band
    const sx = (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5) * width;
    const sy = (((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * -0.5 + 0.5) * height;
    const dx = sx - brush.x;
    const dy = sy - brush.y;
    if (dx * dx + dy * dy <= r2) hits.push(i);
  }
  return hits;
}

/**
 * Applies a brush stroke: surface raycast at the centre, depth band, screen disc.
 * Returns `null` if the brush is over the void (no surface touched).
 */
export function selectByBrush(
  handle: SplatSceneHandle,
  centers: Float32Array,
  isHidden: (index: number) => boolean,
  viewport: { width: number; height: number },
  point: { x: number; y: number },
  radiusPx: number,
  prev: ReadonlySet<number>,
  combine: SelectCombine,
): Set<number> | null {
  const { THREE, camera, mesh } = handle;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2((point.x / viewport.width) * 2 - 1, -(point.y / viewport.height) * 2 + 1),
    camera,
  );
  const hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
  mesh.raycast(raycaster, hits);
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.distance - b.distance);
  // Seen depth of the surface = -z in camera space (equivalent to the perspective clip w).
  const hitView = hits[0].point.clone().applyMatrix4(camera.matrixWorldInverse);
  const viewZ = -hitView.z;
  const halfDepth = depthBand(viewZ);
  mesh.updateWorldMatrix(true, false);
  const m = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(mesh.matrixWorld);
  const found = collectBrushHits(
    m.elements,
    centers,
    isHidden,
    viewport,
    { x: point.x, y: point.y, radiusPx },
    { viewZ, halfDepth },
  );
  return combineSelection(prev, found, combine);
}
