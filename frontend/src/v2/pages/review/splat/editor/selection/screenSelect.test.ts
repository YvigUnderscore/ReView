import { describe, expect, it } from 'vitest';
import { collectHits } from './screenSelect';

// Matrice identité en colonne-major (clip = position ; w = 1).
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const VIEWPORT = { width: 100, height: 100 };
const NONE = () => false;
const ALL = () => true;

describe('collectHits', () => {
  it('projette les centres en pixels (NDC → écran, Y inversé)', () => {
    // (0,0,0) → centre écran (50,50) ; (0.5,0.5,0) → (75,25).
    const centers = new Float32Array([0, 0, 0, 0.5, 0.5, 0]);
    const inRect = (x: number, y: number) => x >= 70 && x <= 80 && y >= 20 && y <= 30;
    expect(collectHits(IDENTITY, centers, NONE, VIEWPORT, inRect)).toEqual([1]);
    expect(collectHits(IDENTITY, centers, NONE, VIEWPORT, ALL)).toEqual([0, 1]);
  });

  it('exclut les splats masqués et ceux hors frustum near/far', () => {
    const centers = new Float32Array([0, 0, 0, 0, 0, 2, 0, 0, -3]); // z=±hors [-1,1]
    expect(collectHits(IDENTITY, centers, NONE, VIEWPORT, ALL)).toEqual([0]);
    expect(collectHits(IDENTITY, centers, (i) => i === 0, VIEWPORT, ALL)).toEqual([]);
  });

  it('exclut les centres derrière la caméra (w ≤ 0)', () => {
    // w = z (e[11]=1, e[15]=0) : z négatif → derrière.
    const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 1, 0, 0, 0, 0];
    const centers = new Float32Array([0, 0, 1, 0, 0, -1]);
    expect(collectHits(e, centers, NONE, VIEWPORT, ALL)).toEqual([0]);
  });
});
