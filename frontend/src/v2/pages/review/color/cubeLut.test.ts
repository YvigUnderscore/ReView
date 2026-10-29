// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parseCubeLut, readSource, sampleLut, tileLayout, toTiles } from './cubeLut';

/** Builds an `n`-sized `.cube` from a transfer function. */
const makeCube = (
  n: number,
  f: (r: number, g: number, b: number) => [number, number, number],
  header = '',
) => {
  const lines = [header, `LUT_3D_SIZE ${n}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const v = f(r / (n - 1), g / (n - 1), b / (n - 1));
        lines.push(v.map((x) => x.toFixed(6)).join(' '));
      }
  return lines.join('\n');
};

const identity = (r: number, g: number, b: number): [number, number, number] => [r, g, b];

describe('cubeLut — reading', () => {
  it('reads the size and orders the red texels first', () => {
    const lut = parseCubeLut(makeCube(5, identity));
    expect(lut.size).toBe(5);
    expect(lut.volume.length).toBe(5 * 5 * 5 * 4);
    // (r=4, g=0, b=2) → saturated red, zero green, blue at mid-course.
    const i = ((2 * 5 + 0) * 5 + 4) * 4;
    expect(lut.volume[i]).toBe(255);
    expect(lut.volume[i + 1]).toBe(0);
    expect(lut.volume[i + 2]).toBe(128);
    expect(lut.volume[i + 3]).toBe(255);
  });

  it('rejects a truncated file, one without a size, or an oversized one', () => {
    expect(() => parseCubeLut('0.0 0.0 0.0')).toThrow(/LUT_3D_SIZE missing/);
    expect(() => parseCubeLut('LUT_3D_SIZE 3\n0.0 0.0 0.0')).toThrow(/truncated/);
    expect(() => parseCubeLut('LUT_3D_SIZE 128\n')).toThrow(/unsupported/);
    expect(() => parseCubeLut('LUT_3D_SIZE 0\n')).toThrow(/unsupported/);
  });

  it('reads the provenance from the header written by the backend', () => {
    expect(readSource('# ReView display transform | source: OpenColorIO 2.4.1')).toBe('ocio');
    expect(readSource('# ReView display transform | source: built-in colorimetric')).toBe('builtin');
    expect(readSource('# some other LUT\nLUT_3D_SIZE 2')).toBe('unknown');
    expect(
      parseCubeLut(makeCube(2, identity, '# ReView display transform | source: OpenColorIO 2.4.1')).source,
    ).toBe('ocio');
  });
});

describe('cubeLut — sampling', () => {
  it('an identity LUT returns the input colour (interpolation included)', () => {
    const lut = parseCubeLut(makeCube(9, identity));
    for (const c of [
      [0, 0, 0],
      [1, 1, 1],
      [0.5, 0.25, 0.75],
      [0.31, 0.62, 0.11],
    ] as [number, number, number][]) {
      const out = sampleLut(lut, c);
      out.forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThan(0.01));
    }
  });

  it('a LUT that inverts the channels also inverts them when sampled', () => {
    const lut = parseCubeLut(makeCube(5, (r, g, b) => [b, r, g]));
    const out = sampleLut(lut, [1, 0, 0.5]);
    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(out[1]).toBeCloseTo(1, 2);
    expect(out[2]).toBeCloseTo(0, 2);
  });

  it('clamps out-of-domain inputs rather than reading outside the grid', () => {
    const lut = parseCubeLut(makeCube(4, identity));
    expect(sampleLut(lut, [-1, 2, 0.5])[0]).toBeCloseTo(0, 5);
    expect(sampleLut(lut, [-1, 2, 0.5])[1]).toBeCloseTo(1, 5);
  });
});

describe('cubeLut — 2D atlas (WebGL1 fallback)', () => {
  it('lays the slices out in the squarest possible grid', () => {
    expect(tileLayout(33)).toEqual({ cols: 6, rows: 6, width: 198, height: 198 });
    expect(tileLayout(16)).toEqual({ cols: 4, rows: 4, width: 64, height: 64 });
  });

  it('copies each texel of the volume into its tile', () => {
    const lut = parseCubeLut(makeCube(4, (r, g, b) => [r, g, b]));
    const atlas = toTiles(lut);
    expect(atlas.data.length).toBe(atlas.width * atlas.height * 4);
    // Slice b=2 → second tile of the first row (cols=2) → column 0, row 1.
    const { cols, width } = atlas;
    const b = 2;
    const ox = (b % cols) * 4;
    const oy = Math.floor(b / cols) * 4;
    const dst = ((oy + 1) * width + ox + 3) * 4; // r=3, g=1, b=2
    expect(atlas.data[dst]).toBe(255);
    expect(atlas.data[dst + 1]).toBe(85);
    expect(atlas.data[dst + 2]).toBe(170);
  });
});
