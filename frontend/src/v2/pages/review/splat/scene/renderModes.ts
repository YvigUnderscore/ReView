// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { createPointCloud, type PointCloud } from './pointCloud';

/**
 * Display modes of a splat (10.G), in the manner of 3D software:
 * - `splats`: normal gaussian rendering (full falloff);
 * - `ellipses`: each gaussian as a **translucent outline** (zero falloff and reduced opacity,
 *   V2): the outlines of the ellipses can be read without the mass blocking the view;
 * - `points`: cloud of centres (`PointCloud` overlay, masked splats). See `pointCloud.ts`.
 */
export type RenderMode = 'splats' | 'ellipses' | 'points';

/** Opacity of the "ellipses" mode: low enough to read overlapping outlines (~15%). */
export const ELLIPSES_OPACITY = 0.15;

/**
 * Sets the attenuation of the SparkRenderer's gaussian kernel (1 = soft splats, 0 = solid ellipses).
 * Writes both the field and the uniform so that it takes effect immediately, whatever the sync cycle.
 */
export function setFalloff(spark: SparkRenderer, value: number): void {
  spark.falloff = value;
  spark.uniforms.falloff.value = value;
}

/**
 * Switches the scene into a display mode: sets the opacity and falloff of the gaussian rendering
 * and (re)builds the points overlay on demand. Returns the current overlay (null outside points
 * mode): the caller keeps the reference for live mirrors (selection, mask, crop) and for release on
 * unmount. The overlay is rebuilt on each entry into the mode (the current masked state is captured
 * at construction; subsequent selection and deletions are mirrored live).
 */
export function applyRenderModeToScene(
  three: typeof import('three'),
  scene: { mesh: SplatMesh; spark: SparkRenderer },
  mode: RenderMode,
  current: PointCloud | null,
): PointCloud | null {
  current?.dispose();
  if (mode === 'points') {
    // Masks the splats (opacity 0) but keeps the mesh "visible" so the overlay child renders.
    scene.mesh.opacity = 0;
    const cloud = createPointCloud(three, scene.mesh);
    scene.mesh.add(cloud.points);
    return cloud;
  }
  if (mode === 'ellipses') {
    // Outlines: flat ellipses (zero falloff) rendered translucent (V2).
    scene.mesh.opacity = ELLIPSES_OPACITY;
    setFalloff(scene.spark, 0);
  } else {
    scene.mesh.opacity = 1;
    setFalloff(scene.spark, 1);
  }
  return null;
}
