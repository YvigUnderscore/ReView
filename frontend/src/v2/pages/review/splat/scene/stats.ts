// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSampler, type Sampler } from '../../three/statsSampler';

/**
 * Metrics of the splat viewer (10.G-V1), without Three/Spark dependency: the sampler receives a
 * `read()` wired to the renderer (active splats, draw calls…) and computes the FPS over a sliding
 * window. Pure and testable; the render loop calls `frame(now)` on each frame, and the HUD panels
 * subscribe (no measurement nor emission without a subscriber).
 *
 * The window mechanics are shared with the 3D viewer (`three/statsSampler`): here we only describe
 * the counters specific to the cloud.
 */
export interface SplatStats {
  /** Frames per second, averaged over the sampling window. */
  fps: number;
  /** Splats rendered by Spark after sorting and LOD (`SparkRenderer.activeSplats`). */
  activeSplats: number;
  /** Total number of splats in the file (`PackedSplats.numSplats`). */
  totalSplats: number;
  /** WebGL draw calls of the last frame (`renderer.info.render.calls`). */
  calls: number;
}

export type StatsSampler = Sampler<Omit<SplatStats, 'fps'>>;

export function createStatsSampler(read: () => Omit<SplatStats, 'fps'>, intervalMs = 500): StatsSampler {
  return createSampler(read, intervalMs);
}
