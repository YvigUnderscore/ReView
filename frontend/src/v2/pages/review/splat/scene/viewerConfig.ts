// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SparkRenderer } from '@sparkjsdev/spark';

/**
 * Spark renderer settings (10.G-V1): culling. Spark clips gaussian centres at 40% outside the frame
 * (`clipXY` 1.4) and bounds a splat's screen radius at 512 px: at a strong zoom (overscale),
 * splats can vanish at the edge of the view.
 *
 * The review keeps this culling **active** by default (lot 8; it had disabled it since 10.G-V1):
 * on real scans, paying for the rendering of out-of-frame gaussians cost more than the rare flicker
 * it avoided. Whoever notices it disables it in one click (the *Scene* panel or the viewer's
 * right-click menu), and their choice is remembered (`cullingDefault`).
 */
export interface CullingConfig {
  clipXY: number;
  maxPixelRadius: number;
}

/** Spark defaults (culling active: faster on very large clouds): the review's default. */
export const CULLING_SPARK: CullingConfig = { clipXY: 1.4, maxPixelRadius: 512 };

/** Culling disabled (on request): no centre clipped, very wide screen radius. */
export const CULLING_OFF: CullingConfig = { clipXY: 100, maxPixelRadius: 4096 };

type CullingTarget = Pick<SparkRenderer, 'clipXY' | 'maxPixelRadius'>;

/** Applies the culling configuration to the SparkRenderer (live, without rebuilding the scene). */
export function applyCulling(spark: CullingTarget, off: boolean): void {
  const cfg = off ? CULLING_OFF : CULLING_SPARK;
  spark.clipXY = cfg.clipXY;
  spark.maxPixelRadius = cfg.maxPixelRadius;
}
