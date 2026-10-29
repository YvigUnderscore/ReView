// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TextureInfo } from './modelStats';

/**
 * Performance counters of the 3D viewer: what the renderer reports each frame (draw calls,
 * triangles actually drawn, objects in memory) plus an estimate of texture memory, which Three does
 * not quantify (`renderer.info.memory.textures` is only a **count** of textures). The supervisor
 * asking "why is it lagging?" reads these four figures.
 *
 * Pure arithmetic, testable: reading the renderer lives in `useModel3DThree`.
 */

/** Metrics read from the renderer at the end of a frame. */
export interface ModelPerfSample {
  /** WebGL render calls (`renderer.info.render.calls`). */
  calls: number;
  /** Triangles actually drawn (`renderer.info.render.triangles`). */
  triangles: number;
  /** Geometries resident in GPU memory (`renderer.info.memory.geometries`). */
  geometries: number;
  /** Textures resident in GPU memory (`renderer.info.memory.textures`). */
  textures: number;
}

export type ModelPerf = { fps: number } & ModelPerfSample;

/** Triangle budget beyond which the viewer warns (order of magnitude of a heavy scene). */
export const TRIANGLE_BUDGET = 1_500_000;

/** Overhead of the mipmap chain: 1 + 1/4 + 1/16 + … ≈ 4/3 of level 0. */
const MIPMAP_FACTOR = 4 / 3;

/**
 * Estimated texture memory, in bytes: each distinct texture counts `width × height × 4`
 * (decompressed RGBA8, what decoding a glTF PNG/JPEG produces), plus mipmaps.
 * A texture appearing on several channels or several materials is counted only once — it is the
 * same GPU resource.
 */
export function estimateTextureBytes(
  textures: readonly Pick<TextureInfo, 'width' | 'height' | 'name'>[],
  withMipmaps = true,
): number {
  const seen = new Set<string>();
  let bytes = 0;
  for (const tex of textures) {
    const w = Number.isFinite(tex.width) ? Math.max(0, tex.width) : 0;
    const h = Number.isFinite(tex.height) ? Math.max(0, tex.height) : 0;
    if (w === 0 || h === 0) continue;
    const key = `${tex.name}:${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bytes += w * h * 4;
  }
  return Math.round(withMipmaps ? bytes * MIPMAP_FACTOR : bytes);
}

/** Megabytes rounded to one decimal — display unit of the panel's memory figures. */
export function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/** Millions of triangles rounded to one decimal — unit of the budget warning. */
export function megaTriangles(triangles: number): number {
  return Math.round((triangles / 1_000_000) * 10) / 10;
}

/** True beyond the triangle budget: the panel then shows a warning. */
export function overTriangleBudget(triangles: number, budget = TRIANGLE_BUDGET): boolean {
  return triangles > budget;
}
