import { describe, it, expect } from 'vitest';
import { wrapIndex } from './lightbox.helpers';

describe('lightbox — wrapIndex (Phase 18)', () => {
  it('boucle en avant', () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(4, 3)).toBe(1);
  });

  it('boucle en arrière', () => {
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(-4, 3)).toBe(2);
  });

  it('reste dans la plage', () => {
    expect(wrapIndex(1, 3)).toBe(1);
  });

  it('protège contre un ensemble vide', () => {
    expect(wrapIndex(2, 0)).toBe(0);
  });
});
