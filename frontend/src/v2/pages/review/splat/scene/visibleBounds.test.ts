// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import { invalidateVisibleBounds, visibleLocalBox } from './visibleBounds';

/** Dummy mesh: splats at the given positions, mutable opacities (simulated masking). */
function makeMesh(points: Array<{ pos: [number, number, number]; opacity: number }>) {
  return {
    points,
    forEachSplat(cb: (i: number, c: THREE.Vector3, s: null, q: null, o: number) => void) {
      points.forEach((p, i) => cb(i, new THREE.Vector3(...p.pos), null, null, p.opacity));
    },
    getBoundingBox: vi.fn(),
  } as unknown as SplatMesh & { points: typeof points };
}

describe('visibleBounds — bbox of visible splats, cache invalidated (11.D)', () => {
  it('ignores masked splats (opacity 0)', () => {
    const mesh = makeMesh([
      { pos: [0, 0, 0], opacity: 1 },
      { pos: [10, 10, 10], opacity: 0 }, // masked: outside the bbox
      { pos: [2, 0, 0], opacity: 0.5 },
    ]);
    const box = visibleLocalBox(THREE, mesh)!;
    expect(box.max.x).toBe(2);
    expect(box.max.y).toBe(0);
  });

  it('serves the cache until it is invalidated, then recomputes', () => {
    const mesh = makeMesh([
      { pos: [0, 0, 0], opacity: 1 },
      { pos: [10, 0, 0], opacity: 1 },
    ]);
    expect(visibleLocalBox(THREE, mesh)!.max.x).toBe(10);
    mesh.points[1].opacity = 0; // non-destructive deletion…
    expect(visibleLocalBox(THREE, mesh)!.max.x).toBe(10); // …cache still served
    invalidateVisibleBounds(mesh);
    expect(visibleLocalBox(THREE, mesh)!.max.x).toBe(0); // recomputed on the visible ones
  });

  it('returns null (and caches it) when no splat is visible any more', () => {
    const mesh = makeMesh([{ pos: [0, 0, 0], opacity: 0 }]);
    // getBoundingBox fallback: simulates an empty Spark bbox.
    (mesh.getBoundingBox as ReturnType<typeof vi.fn>).mockReturnValue(new THREE.Box3());
    expect(visibleLocalBox(THREE, mesh)).toBeNull();
    expect(visibleLocalBox(THREE, mesh)).toBeNull();
    expect(mesh.getBoundingBox).toHaveBeenCalledTimes(1); // second call served by the cache
  });

  it('returned clones do not alter the cache', () => {
    const mesh = makeMesh([{ pos: [1, 1, 1], opacity: 1 }]);
    const a = visibleLocalBox(THREE, mesh)!;
    a.expandByPoint(new THREE.Vector3(100, 100, 100));
    expect(visibleLocalBox(THREE, mesh)!.max.x).toBe(1);
  });
});
