import { describe, expect, it } from 'vitest';
import { decodeSubsetOps, encodeSubsetOps, type SubsetOp } from './subsetOps';

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
    expect(op!.delta[0]).toBe(0.123456789012345);
  });
});
