// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SplatSceneHandle } from '../../useSplat';
import {
  applySubsetOps,
  applySubsetOpsReversible,
  decodeSubsetOps,
  encodeSubsetOps,
  revertSubsetOps,
  type SubsetOp,
} from './subsetOps';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('encode/decodeSubsetOps — binary round-trip', () => {
  it('restores the ops unchanged (delta + indices)', () => {
    const ops: SubsetOp[] = [
      { delta: IDENTITY.map((v, i) => (i === 12 ? 2.5 : v)), indices: [0, 7, 42] },
      { delta: IDENTITY, indices: [100000] },
    ];
    const decoded = decodeSubsetOps(encodeSubsetOps(ops));
    expect(decoded).toEqual(ops);
  });

  it('empty list gives zero ops', () => {
    expect(decodeSubsetOps(encodeSubsetOps([]))).toEqual([]);
  });

  it('rejects an unknown or truncated format', () => {
    expect(() => decodeSubsetOps(new Uint8Array([9, 9]))).toThrow();
    const bytes = encodeSubsetOps([{ delta: IDENTITY, indices: [1, 2, 3] }]);
    expect(() => decodeSubsetOps(bytes.subarray(0, bytes.length - 4))).toThrow();
  });

  it('preserves float64 precision', () => {
    const delta = [...IDENTITY];
    delta[0] = 0.123456789012345;
    const [op] = decodeSubsetOps(encodeSubsetOps([{ delta, indices: [5] }]));
    expect(op.delta[0]).toBe(0.123456789012345);
  });
});

/**
 * Dummy handle with 3 splats: a store of centers, plus the real `three` (the ops decompose
 * a 4×4 matrix; replacing it with a fake would prove nothing about the replay).
 */
function makeHandle() {
  const centers = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(4, 0, 0)];
  const packed = {
    needsUpdate: false,
    getSplat: (i: number) => ({
      center: centers[i],
      scales: new THREE.Vector3(1, 1, 1),
      quaternion: new THREE.Quaternion(),
      opacity: 1,
      color: new THREE.Color(),
    }),
    setSplat: (i: number, c: THREE.Vector3) => {
      centers[i] = c.clone();
    },
  };
  const mesh = { packedSplats: packed, updateGenerator: () => undefined };
  return { handle: { mesh, THREE } as unknown as SplatSceneHandle, centers };
}

const shift = (x: number) => {
  const m = [...IDENTITY];
  m[12] = x;
  return m;
};

describe('applySubsetOps — replay, and undoable replay (lot 14)', () => {
  it('moves the targeted splats, and only them', () => {
    const { handle, centers } = makeHandle();
    applySubsetOps(handle, [{ delta: shift(10), indices: [1] }]);
    expect(centers.map((c) => c.x)).toEqual([0, 12, 4]);
  });

  /**
   * A comment proposal is RELEASED: without a snapshot, leaving the comment would leave the
   * cloud moved until the next reload.
   */
  it('puts the cloud back exactly where it was, stacked ops included', () => {
    const { handle, centers } = makeHandle();
    const before = centers.map((c) => c.clone());
    const snaps = applySubsetOpsReversible(handle, [
      { delta: shift(10), indices: [0, 1] },
      { delta: shift(5), indices: [1, 2] },
    ]);
    expect(centers.map((c) => c.x)).toEqual([10, 17, 9]);
    revertSubsetOps(handle, snaps);
    expect(centers.map((c) => c.x)).toEqual(before.map((c) => c.x));
  });

  it('an op that targets nothing leaves nothing to undo', () => {
    const { handle } = makeHandle();
    expect(applySubsetOpsReversible(handle, [{ delta: IDENTITY, indices: [] }])).toEqual([]);
  });
});
