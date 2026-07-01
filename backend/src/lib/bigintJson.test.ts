import { describe, it, expect } from 'vitest';
import './bigintJson';

describe('bigintJson', () => {
  it('rend les BigInt sérialisables par JSON.stringify', () => {
    expect(JSON.stringify(42n)).toBe('42');
  });
  it('sérialise les colonnes BigInt imbriquées (ex. taille fichier)', () => {
    expect(JSON.stringify({ size: 1024n })).toBe('{"size":1024}');
  });
});
