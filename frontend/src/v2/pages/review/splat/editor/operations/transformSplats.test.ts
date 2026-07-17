import { describe, expect, it } from 'vitest';
import { centroidOfCenters } from './transformSplats';

describe('centroidOfCenters', () => {
  it('moyenne les centres du lot sélectionné', () => {
    // 3 splats : (0,0,0), (2,0,0), (4,0,0) — barycentre des index 0 et 2 = (2,0,0).
    const centers = new Float32Array([0, 0, 0, 2, 0, 0, 4, 0, 0]);
    expect(centroidOfCenters(centers, [0, 2])).toEqual([2, 0, 0]);
  });

  it('barycentre 3D complet', () => {
    const centers = new Float32Array([1, 1, 1, 3, 5, 7]);
    expect(centroidOfCenters(centers, [0, 1])).toEqual([2, 3, 4]);
  });

  it('lot vide → origine', () => {
    expect(centroidOfCenters(new Float32Array([1, 2, 3]), [])).toEqual([0, 0, 0]);
  });
});
