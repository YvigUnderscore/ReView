import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { syncSphereRadius } from './cropVolume';

/** SDF factice : seuls userData/scale/radius sont lus par syncSphereRadius. */
const fakeSdf = (shape: 'box' | 'sphere', [x, y, z]: [number, number, number]) =>
  ({ userData: { volumeShape: shape }, scale: { x, y, z }, radius: 99 }) as unknown as THREE.Object3D & {
    radius: number;
  };

describe('syncSphereRadius — rayon SDF sphère dérivé de l’échelle (11.F)', () => {
  it('sphère isotrope : rayon = échelle', () => {
    const sdf = fakeSdf('sphere', [2.5, 2.5, 2.5]);
    syncSphereRadius(sdf);
    expect(sdf.radius).toBeCloseTo(2.5);
  });

  it('sphère anisotrope : moyenne des composantes (le SDF est isotrope)', () => {
    const sdf = fakeSdf('sphere', [1, 2, 3]);
    syncSphereRadius(sdf);
    expect(sdf.radius).toBeCloseTo(2);
  });

  it('boîte : rayon (arrondi de coins) laissé intact', () => {
    const sdf = fakeSdf('box', [4, 4, 4]);
    syncSphereRadius(sdf);
    expect(sdf.radius).toBe(99);
  });
});
