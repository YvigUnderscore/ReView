import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SplatSceneHandle } from '../../useSplat';
import { meshBounds, selectionBounds } from './bounds';

/** Mesh factice : splats en (0,0,0), (2,0,0), (0,2,0) — le 3ᵉ masqué (opacité 0). */
function makeHandle(matrix = new THREE.Matrix4()): SplatSceneHandle {
  const centers = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(0, 2, 0)];
  const opacities = [1, 1, 0];
  const mesh = {
    matrixWorld: matrix,
    updateMatrixWorld: () => undefined,
    forEachSplat: (cb: (i: number, c: THREE.Vector3, s: null, q: null, o: number) => void) => {
      centers.forEach((c, i) => cb(i, c, null, null, opacities[i]));
    },
    getBoundingBox: () => new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
  };
  return { THREE, mesh } as unknown as SplatSceneHandle;
}

describe('selectionBounds', () => {
  it('englobe les splats sélectionnés visibles, en monde', () => {
    const b = selectionBounds(makeHandle(), new Set([0, 1, 2]));
    // Le splat 2 est masqué : sphère entre (0,0,0) et (2,0,0).
    expect(b).not.toBeNull();
    expect(b!.center.x).toBeCloseTo(1);
    expect(b!.center.y).toBeCloseTo(0);
    expect(b!.radius).toBeCloseTo(1);
  });

  it('applique la transformation du mesh (gizmos)', () => {
    const b = selectionBounds(makeHandle(new THREE.Matrix4().makeTranslation(10, 0, 0)), new Set([0, 1]));
    expect(b!.center.x).toBeCloseTo(11);
  });

  it('sélection vide → null ; splat unique → rayon plancher', () => {
    expect(selectionBounds(makeHandle(), new Set())).toBeNull();
    const single = selectionBounds(makeHandle(), new Set([0]));
    expect(single!.radius).toBeGreaterThan(0);
  });
});

describe('meshBounds', () => {
  it('transforme la bbox du mesh en monde', () => {
    const b = meshBounds(makeHandle(new THREE.Matrix4().makeScale(2, 2, 2)));
    expect(b!.radius).toBeCloseTo(Math.sqrt(3) * 2);
  });
});
