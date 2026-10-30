// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { base64ToBytes, bytesToBase64, decodeMask, encodeMask } from './mask';

describe('encodeMask / decodeMask', () => {
  it('round-trips sparse indices', () => {
    const indices = [0, 2, 9, 63, 64, 1000];
    const bytes = encodeMask(indices);
    expect(bytes.length).toBe(Math.ceil(1001 / 8));
    expect(decodeMask(bytes).sort((a, b) => a - b)).toEqual(indices);
  });

  it('encodes the expected bits (LSB-first per byte)', () => {
    // splats 0, 2 and 9 → byte 0 = 0b0000_0101, byte 1 = 0b0000_0010
    const bytes = encodeMask([0, 2, 9]);
    expect([...bytes]).toEqual([0b0000_0101, 0b0000_0010]);
  });

  it('empty set gives an empty bitset', () => {
    expect(encodeMask([]).length).toBe(0);
    expect(decodeMask(new Uint8Array(0))).toEqual([]);
  });

  it('ignores invalid indices (negative, non-integer)', () => {
    expect(decodeMask(encodeMask([-1, 1.5, 3]))).toEqual([3]);
  });
});

describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips, including on a large array', () => {
    const big = new Uint8Array(70_000).map((_, i) => i % 251);
    const b64 = bytesToBase64(big);
    expect([...base64ToBytes(b64)]).toEqual([...big]);
  });

  it('matches the reference base64', () => {
    expect(bytesToBase64(new Uint8Array([5, 2]))).toBe(btoa(String.fromCharCode(5, 2)));
  });
});
