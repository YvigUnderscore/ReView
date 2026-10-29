// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import { createPointCloud } from './pointCloud';

/** Dummy mesh: N splats with given colour and opacity (index = order). */
function makeMesh(
  splats: Array<{ pos: [number, number, number]; rgb: [number, number, number]; opacity: number }>,
) {
  return {
    packedSplats: { numSplats: splats.length },
    forEachSplat(cb: (i: number, c: THREE.Vector3, s: null, q: null, o: number, col: THREE.Color) => void) {
      splats.forEach((sp, i) =>
        cb(i, new THREE.Vector3(...sp.pos), null, null, sp.opacity, new THREE.Color(...sp.rgb)),
      );
    },
  } as unknown as SplatMesh;
}

const posOf = (points: THREE.Points) => points.geometry.getAttribute('position').array as Float32Array;
const colOf = (points: THREE.Points) => points.geometry.getAttribute('color').array as Float32Array;

describe('pointCloud — reactive overlay of the points mode', () => {
  it('carves out (NaN) the splats already masked at construction', () => {
    const mesh = makeMesh([
      { pos: [0, 0, 0], rgb: [1, 0, 0], opacity: 1 },
      { pos: [1, 1, 1], rgb: [0, 1, 0], opacity: 0 }, // masked
    ]);
    const pc = createPointCloud(THREE, mesh);
    const pos = posOf(pc.points);
    expect(pos[0]).toBe(0);
    expect(Number.isNaN(pos[3])).toBe(true); // masked splat carved out
  });

  it('tints the selection then restores the original colour on deselection', () => {
    const mesh = makeMesh([
      { pos: [0, 0, 0], rgb: [0.2, 0.2, 0.2], opacity: 1 },
      { pos: [1, 0, 0], rgb: [0.4, 0.4, 0.4], opacity: 1 },
    ]);
    const pc = createPointCloud(THREE, mesh);
    pc.setSelection(new Set([1]));
    const col = colOf(pc.points);
    expect(col[3]).toBeCloseTo(1); // red of the #ffaa33 tint
    expect(col[4]).toBeCloseTo(170 / 255);
    expect(col[0]).toBeCloseTo(0.2); // splat 0 unchanged
    pc.setSelection(new Set()); // deselection: original colour restored
    expect(colOf(pc.points)[3]).toBeCloseTo(0.4);
  });

  it('masks and restores a point (deletion / undo) via NaN', () => {
    const mesh = makeMesh([{ pos: [5, 6, 7], rgb: [1, 1, 1], opacity: 1 }]);
    const pc = createPointCloud(THREE, mesh);
    pc.setHidden([0], true);
    expect(Number.isNaN(posOf(pc.points)[0])).toBe(true);
    pc.setHidden([0], false); // undo: original centre restored
    expect(posOf(pc.points)[0]).toBe(5);
    expect(posOf(pc.points)[2]).toBe(7);
  });
});
