// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SplatSceneHandle } from '../../useSplat';
import { meshBounds, selectionBounds } from './bounds';

/** Dummy mesh: splats at (0,0,0), (2,0,0), (0,2,0); the 3rd is hidden (opacity 0). */
function makeHandle(matrix = new THREE.Matrix4()): SplatSceneHandle {
  const centers = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(0, 2, 0)];
  const opacities = [1, 1, 0];
  const mesh = {
    matrixWorld: matrix,
    updateWorldMatrix: () => undefined,
    forEachSplat: (cb: (i: number, c: THREE.Vector3, s: null, q: null, o: number) => void) => {
      centers.forEach((c, i) => cb(i, c, null, null, opacities[i]));
    },
    getBoundingBox: () => new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
  };
  return { THREE, mesh } as unknown as SplatSceneHandle;
}

describe('selectionBounds', () => {
  it('bounds the visible selected splats, in world space', () => {
    const b = selectionBounds(makeHandle(), new Set([0, 1, 2]));
    // Splat 2 is hidden: sphere between (0,0,0) and (2,0,0).
    expect(b).not.toBeNull();
    expect(b!.center.x).toBeCloseTo(1);
    expect(b!.center.y).toBeCloseTo(0);
    expect(b!.radius).toBeCloseTo(1);
  });

  it('applies the mesh transform (gizmos)', () => {
    const b = selectionBounds(makeHandle(new THREE.Matrix4().makeTranslation(10, 0, 0)), new Set([0, 1]));
    expect(b!.center.x).toBeCloseTo(11);
  });

  it('empty selection gives null; single splat gives the floor radius', () => {
    expect(selectionBounds(makeHandle(), new Set())).toBeNull();
    const single = selectionBounds(makeHandle(), new Set([0]));
    expect(single!.radius).toBeGreaterThan(0);
  });
});

describe('meshBounds', () => {
  it('bounds the visible splats (hidden excluded, 11.D) and applies the world transform', () => {
    const b = meshBounds(makeHandle(new THREE.Matrix4().makeScale(2, 2, 2)));
    // Visible splats (0,0,0) and (2,0,0) → local bbox [0..2]; scale ×2 → center (2,0,0), radius 2.
    expect(b!.center.x).toBeCloseTo(2);
    expect(b!.center.y).toBeCloseTo(0);
    expect(b!.radius).toBeCloseTo(2);
  });
});
