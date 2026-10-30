// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';

import { autoRadius, encodePng, project, renderPointCloudPng, robustRange } from './pointThumbnail';
import type { PointCloud } from './splatPoints';

/** Minimal PNG decoder (RGBA, filter 0) — just enough to reread what we have just written. */
function decodePng(png: Buffer): { width: number; height: number; pixels: Buffer } {
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('latin1');
    const data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (stride + 1)]).toBe(0);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, pixels };
}

function cloudOf(points: readonly (readonly number[])[]): PointCloud {
  const positions = new Float32Array(points.length * 3);
  const colors = new Uint8Array(points.length * 3);
  points.forEach((p, i) => {
    positions.set([p[0]!, p[1]!, p[2]!], i * 3);
    colors.set([p[3] ?? 255, p[4] ?? 255, p[5] ?? 255], i * 3);
  });
  return { count: points.length, positions, colors };
}

/** Dense cubic grid: enough to obtain a full silhouette on screen. */
function cubeCloud(side: number): PointCloud {
  const rows: number[][] = [];
  for (let x = 0; x < side; x += 1)
    for (let y = 0; y < side; y += 1)
      for (let z = 0; z < side; z += 1) rows.push([x / side, y / side, z / side, 200, 40, 90]);
  return cloudOf(rows);
}

describe('robustRange', () => {
  it('discards outlier values that would zoom out the whole view', () => {
    const values = new Float32Array(1000);
    for (let i = 0; i < 1000; i += 1) values[i] = i / 999;
    values[0] = -5000;
    values[999] = 5000;
    const [lo, hi] = robustRange(values, 1000, 0.01);
    expect(lo).toBeGreaterThan(-1);
    expect(hi).toBeLessThan(2);
  });

  it('returns a null range for an empty cloud', () => {
    expect(robustRange(new Float32Array(0), 0)).toEqual([0, 0]);
  });
});

describe('project', () => {
  it('from the front and level, the projection is the identity on X/Y', () => {
    const { u, v, depth } = project(cloudOf([[3, 5, 7]]), 0, 0);
    expect(u[0]).toBeCloseTo(3, 5);
    expect(v[0]).toBeCloseTo(5, 5);
    expect(depth[0]).toBeCloseTo(7, 5);
  });

  it('keeps an orthonormal frame whatever the orientation', () => {
    // Three points on the axes: the projected norms must not swell.
    const { u, v, depth } = project(cloudOf([[1, 0, 0]]), 35, 22);
    const norm = Math.hypot(u[0]!, v[0]!, depth[0]!);
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe('autoRadius', () => {
  it('bounds the disc radius between 1 and 3 pixels', () => {
    expect(autoRadius(512, 1)).toBe(3);
    expect(autoRadius(512, 1_000_000)).toBe(1);
    expect(autoRadius(512, 0)).toBe(1);
  });
});

describe('renderPointCloudPng', () => {
  it('renders a square RGBA PNG, transparent background and centred subject', () => {
    const png = renderPointCloudPng(cubeCloud(24), { size: 64 });
    expect(png).not.toBeNull();
    const { width, height, pixels } = decodePng(png!);
    expect([width, height]).toEqual([64, 64]);

    // The top-left corner stays transparent: the thumbnail takes the colour of the theme.
    expect(pixels[3]).toBe(0);
    // The centre is covered by the cube.
    const center = (32 * 64 + 32) * 4;
    expect(pixels[center + 3]).toBe(255);
    expect(pixels[center]).toBeGreaterThan(pixels[center + 1]!);
  });

  it('renders nothing rather than an empty image when there is nothing to see', () => {
    expect(renderPointCloudPng(cloudOf([]))).toBeNull();
    // All points coincide: no extent, hence no possible framing.
    expect(
      renderPointCloudPng(
        cloudOf([
          [1, 1, 1],
          [1, 1, 1],
        ]),
      ),
    ).toBeNull();
  });

  it('respects the requested size, floor included', () => {
    const small = renderPointCloudPng(cubeCloud(8), { size: 4 });
    expect(decodePng(small!).width).toBe(32);
  });
});

describe('encodePng', () => {
  it('writes a PNG readable byte for byte', () => {
    const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const { width, height, pixels } = decodePng(encodePng(rgba, 2, 2));
    expect([width, height]).toEqual([2, 2]);
    expect(Array.from(pixels)).toEqual(Array.from(rgba));
  });
});
