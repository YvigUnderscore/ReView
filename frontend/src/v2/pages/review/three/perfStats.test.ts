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
  it('compte 4 octets par texel, mipmaps compris', () => {
    // 1024×1024 RGBA = 4 Mio, ×4/3 avec les mipmaps.
    expect(estimateTextureBytes([tex('albedo', 1024, 1024)])).toBe(Math.round(4 * 1024 * 1024 * (4 / 3)));
    expect(estimateTextureBytes([tex('albedo', 1024, 1024)], false)).toBe(4 * 1024 * 1024);
  });

  it('ne compte qu’une fois une texture partagée entre canaux ou matériaux', () => {
    const one = estimateTextureBytes([tex('albedo', 512, 512)]);
    expect(estimateTextureBytes([tex('albedo', 512, 512), tex('albedo', 512, 512)])).toBe(one);
    // Deux textures distinctes de même taille comptent bien double (à l'arrondi près).
    expect(estimateTextureBytes([tex('albedo', 512, 512), tex('normal', 512, 512)])).toBeCloseTo(one * 2, -1);
  });

  it('ignore les textures sans dimensions connues', () => {
    expect(estimateTextureBytes([tex('vide', 0, 0), tex('nan', Number.NaN, 512)])).toBe(0);
  });
});

describe('perfStats — unités et budget', () => {
  it('convertit en Mo et en millions de triangles au dixième', () => {
    expect(megabytes(1024 * 1024)).toBe(1);
    expect(megabytes(1024 * 1024 * 1.55)).toBe(1.6);
    expect(megaTriangles(1_500_000)).toBe(1.5);
  });

  it('n’avertit qu’au-delà du budget de triangles', () => {
    expect(overTriangleBudget(TRIANGLE_BUDGET)).toBe(false);
    expect(overTriangleBudget(TRIANGLE_BUDGET + 1)).toBe(true);
    expect(overTriangleBudget(50_000, 10_000)).toBe(true);
  });
});
