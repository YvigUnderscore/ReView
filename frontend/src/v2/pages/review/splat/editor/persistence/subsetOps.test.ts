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

describe('encode/decodeSubsetOps — round-trip binaire', () => {
  it('restitue les ops à l’identique (delta + indices)', () => {
    const ops: SubsetOp[] = [
      { delta: IDENTITY.map((v, i) => (i === 12 ? 2.5 : v)), indices: [0, 7, 42] },
      { delta: IDENTITY, indices: [100000] },
    ];
    const decoded = decodeSubsetOps(encodeSubsetOps(ops));
    expect(decoded).toEqual(ops);
  });

  it('liste vide → zéro op', () => {
    expect(decodeSubsetOps(encodeSubsetOps([]))).toEqual([]);
  });

  it('rejette un format inconnu ou tronqué', () => {
    expect(() => decodeSubsetOps(new Uint8Array([9, 9]))).toThrow();
    const bytes = encodeSubsetOps([{ delta: IDENTITY, indices: [1, 2, 3] }]);
    expect(() => decodeSubsetOps(bytes.subarray(0, bytes.length - 4))).toThrow();
  });

  it('préserve la précision des flottants (float64)', () => {
    const delta = [...IDENTITY];
    delta[0] = 0.123456789012345;
    const [op] = decodeSubsetOps(encodeSubsetOps([{ delta, indices: [5] }]));
    expect(op.delta[0]).toBe(0.123456789012345);
  });
});

/**
 * Poignée factice à 3 splats : un magasin de centres, plus le vrai `three` (les ops décomposent
 * une matrice 4×4 — la remplacer par un faux ne prouverait rien du rejeu).
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

describe('applySubsetOps — rejeu, et rejeu défaisable (lot 14)', () => {
  it('déplace les splats visés, et seulement eux', () => {
    const { handle, centers } = makeHandle();
    applySubsetOps(handle, [{ delta: shift(10), indices: [1] }]);
    expect(centers.map((c) => c.x)).toEqual([0, 12, 4]);
  });

  /**
   * Une proposition de commentaire se RELÂCHE : sans instantané, quitter le commentaire
   * laisserait le nuage déplacé jusqu'au prochain rechargement.
   */
  it('rend le nuage exactement où il était, ops empilées comprises', () => {
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

  it('une op qui ne vise rien ne laisse rien à défaire', () => {
    const { handle } = makeHandle();
    expect(applySubsetOpsReversible(handle, [{ delta: IDENTITY, indices: [] }])).toEqual([]);
  });
});
