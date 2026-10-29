// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  estimateTextureBytes,
  megaTriangles,
  megabytes,
  overTriangleBudget,
  TRIANGLE_BUDGET,
} from './perfStats';

const tex = (name: string, width: number, height: number) => ({ name, width, height });

describe('perfStats.estimateTextureBytes', () => {
  it('counts 4 bytes per texel, mipmaps included', () => {
    // 1024×1024 RGBA = 4 MiB, ×4/3 with mipmaps.
    expect(estimateTextureBytes([tex('albedo', 1024, 1024)])).toBe(Math.round(4 * 1024 * 1024 * (4 / 3)));
    expect(estimateTextureBytes([tex('albedo', 1024, 1024)], false)).toBe(4 * 1024 * 1024);
  });

  it('counts a texture shared between channels or materials only once', () => {
    const one = estimateTextureBytes([tex('albedo', 512, 512)]);
    expect(estimateTextureBytes([tex('albedo', 512, 512), tex('albedo', 512, 512)])).toBe(one);
    // Two distinct textures of the same size do count double (up to rounding).
    expect(estimateTextureBytes([tex('albedo', 512, 512), tex('normal', 512, 512)])).toBeCloseTo(one * 2, -1);
  });

  it('ignores textures with unknown dimensions', () => {
    expect(estimateTextureBytes([tex('empty', 0, 0), tex('nan', Number.NaN, 512)])).toBe(0);
  });
});

describe('perfStats — units and budget', () => {
  it('converts to MB and to millions of triangles to one decimal', () => {
    expect(megabytes(1024 * 1024)).toBe(1);
    expect(megabytes(1024 * 1024 * 1.55)).toBe(1.6);
    expect(megaTriangles(1_500_000)).toBe(1.5);
  });

  it('only warns beyond the triangle budget', () => {
    expect(overTriangleBudget(TRIANGLE_BUDGET)).toBe(false);
    expect(overTriangleBudget(TRIANGLE_BUDGET + 1)).toBe(true);
    expect(overTriangleBudget(50_000, 10_000)).toBe(true);
  });
});
