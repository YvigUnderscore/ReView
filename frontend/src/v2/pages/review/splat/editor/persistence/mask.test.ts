import { describe, it, expect } from 'vitest';
import { base64ToBytes, bytesToBase64, decodeMask, encodeMask } from './mask';

describe('encodeMask / decodeMask', () => {
  it('fait l’aller-retour sur des indices épars', () => {
    const indices = [0, 2, 9, 63, 64, 1000];
    const bytes = encodeMask(indices);
    expect(bytes.length).toBe(Math.ceil(1001 / 8));
    expect(decodeMask(bytes).sort((a, b) => a - b)).toEqual(indices);
  });

  it('encode les bits attendus (LSB-first par octet)', () => {
    // splats 0, 2 et 9 → octet 0 = 0b0000_0101, octet 1 = 0b0000_0010
    const bytes = encodeMask([0, 2, 9]);
    expect([...bytes]).toEqual([0b0000_0101, 0b0000_0010]);
  });

  it('ensemble vide → bitset vide', () => {
    expect(encodeMask([]).length).toBe(0);
    expect(decodeMask(new Uint8Array(0))).toEqual([]);
  });

  it('ignore les indices invalides (négatifs, non entiers)', () => {
    expect(decodeMask(encodeMask([-1, 1.5, 3]))).toEqual([3]);
  });
});

describe('bytesToBase64 / base64ToBytes', () => {
  it('fait l’aller-retour, y compris sur un grand tableau', () => {
    const big = new Uint8Array(70_000).map((_, i) => i % 251);
    const b64 = bytesToBase64(big);
    expect([...base64ToBytes(b64)]).toEqual([...big]);
  });

  it('correspond au base64 de référence', () => {
    expect(bytesToBase64(new Uint8Array([5, 2]))).toBe(btoa(String.fromCharCode(5, 2)));
  });
});
