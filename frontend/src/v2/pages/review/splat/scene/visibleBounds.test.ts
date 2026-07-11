import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import { invalidateVisibleBounds, visibleLocalBox } from './visibleBounds';

/** Mesh factice : splats aux positions données, opacités mutables (masquage simulé). */
function makeMesh(points: Array<{ pos: [number, number, number]; opacity: number }>) {
  return {
    points,
    forEachSplat(cb: (i: number, c: THREE.Vector3, s: null, q: null, o: number) => void) {
      points.forEach((p, i) => cb(i, new THREE.Vector3(...p.pos), null, null, p.opacity));
    },
    getBoundingBox: vi.fn(),
  } as unknown as SplatMesh & { points: typeof points };
}

describe('visibleBounds — bbox des splats visibles, cache invalidé (11.D)', () => {
  it('ignore les splats masqués (opacité 0)', () => {
    const mesh = makeMesh([
      { pos: [0, 0, 0], opacity: 1 },
      { pos: [10, 10, 10], opacity: 0 }, // masqué : hors bbox
      { pos: [2, 0, 0], opacity: 0.5 },
    ]);
    const box = visibleLocalBox(THREE, mesh)!;
    expect(box.max.x).toBe(2);
    expect(box.max.y).toBe(0);
  });

  it('sert le cache tant qu’il n’est pas invalidé, puis recalcule', () => {
    const mesh = makeMesh([
      { pos: [0, 0, 0], opacity: 1 },
      { pos: [10, 0, 0], opacity: 1 },
    ]);
    expect(visibleLocalBox(THREE, mesh)!.max.x).toBe(10);
    mesh.points[1]!.opacity = 0; // suppression non-destructive…
    expect(visibleLocalBox(THREE, mesh)!.max.x).toBe(10); // …cache encore servi
    invalidateVisibleBounds(mesh);
    expect(visibleLocalBox(THREE, mesh)!.max.x).toBe(0); // recalculé sur les visibles
  });

  it('renvoie null (et le met en cache) quand plus aucun splat n’est visible', () => {
    const mesh = makeMesh([{ pos: [0, 0, 0], opacity: 0 }]);
    // Repli getBoundingBox : simule une bbox Spark vide.
    (mesh.getBoundingBox as ReturnType<typeof vi.fn>).mockReturnValue(new THREE.Box3());
    expect(visibleLocalBox(THREE, mesh)).toBeNull();
    expect(visibleLocalBox(THREE, mesh)).toBeNull();
    expect(mesh.getBoundingBox).toHaveBeenCalledTimes(1); // second appel servi par le cache
  });

  it('les clones renvoyés n’altèrent pas le cache', () => {
    const mesh = makeMesh([{ pos: [1, 1, 1], opacity: 1 }]);
    const a = visibleLocalBox(THREE, mesh)!;
    a.expandByPoint(new THREE.Vector3(100, 100, 100));
    expect(visibleLocalBox(THREE, mesh)!.max.x).toBe(1);
  });
});
