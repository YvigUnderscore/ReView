// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BakedSplat } from './bakeSplats';

/**
 * Writing a **.spz** file (Spark's compact format: a gzip container ~10× smaller than the PLY,
 * loaded natively) from baked splats, 41.C. Thin glue over Spark's `SpzWriter` (imported
 * dynamically, out of the initial bundle).
 *
 * SH degree 0: `PackedSplats.getSplat` only returns the base colour (the spherical harmonics live
 * in separate textures), so the export keeps the diffuse colour but not the view-dependent colour.
 * This limit is accepted and documented.
 */
export async function writeSpz(splats: readonly BakedSplat[]): Promise<Uint8Array> {
  const { SpzWriter } = await import('@sparkjsdev/spark');
  const writer = new SpzWriter({
    numSplats: splats.length,
    shDegree: 0,
    fractionalBits: 12,
    flagAntiAlias: false,
  });
  for (let i = 0; i < splats.length; i++) {
    const s = splats[i];
    writer.setCenter(i, s.center[0], s.center[1], s.center[2]);
    writer.setScale(i, s.scales[0], s.scales[1], s.scales[2]);
    writer.setQuat(i, s.quaternion[0], s.quaternion[1], s.quaternion[2], s.quaternion[3]);
    writer.setAlpha(i, s.opacity);
    writer.setRgb(i, s.color[0], s.color[1], s.color[2]);
  }
  return writer.finalize();
}
