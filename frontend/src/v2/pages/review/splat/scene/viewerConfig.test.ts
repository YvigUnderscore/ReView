// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { applyCulling, CULLING_OFF, CULLING_SPARK } from './viewerConfig';

describe('applyCulling', () => {
  it('neutralise le culling (défaut review)', () => {
    const spark = { clipXY: 1.4, maxPixelRadius: 512 };
    applyCulling(spark, true);
    expect(spark.clipXY).toBe(CULLING_OFF.clipXY);
    expect(spark.maxPixelRadius).toBe(CULLING_OFF.maxPixelRadius);
  });

  it('rétablit les défauts Spark', () => {
    const spark = { clipXY: 100, maxPixelRadius: 4096 };
    applyCulling(spark, false);
    expect(spark.clipXY).toBe(CULLING_SPARK.clipXY);
    expect(spark.maxPixelRadius).toBe(CULLING_SPARK.maxPixelRadius);
  });
});
