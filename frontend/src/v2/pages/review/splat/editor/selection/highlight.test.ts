import { describe, expect, it, vi } from 'vitest';
import type { RgbaArray } from '@sparkjsdev/spark';
import type { SplatSceneHandle } from '../../useSplat';
import { createSelectionHighlight, HIGHLIGHT_RGB } from './highlight';

class FakeRgbaArray {
  count = 0;
  needsUpdate = false;
  array: Uint8Array | null = null;
  disposed = false;
  ensureCapacity(n: number) {
    this.array = new Uint8Array(n * 4);
    return this.array;
  }
  dispose() {
    this.disposed = true;
  }
}

/** Mesh factice : 2 splats (rouge opaque, vert semi-transparent). */
function makeMesh() {
  const splats = [
    { color: { r: 1, g: 0, b: 0 }, opacity: 1 },
    { color: { r: 0, g: 1, b: 0 }, opacity: 0.5 },
  ];
  return {
    splats,
    packedSplats: { numSplats: 2, getSplat: (i: number) => ({ opacity: splats[i].opacity }) },
    forEachSplat(cb: (i: number, c: null, s: null, q: null, o: number, col: unknown) => void) {
      splats.forEach((s, i) => cb(i, null, null, null, s.opacity, s.color));
    },
    splatRgba: null as unknown,
    needsUpdate: false,
    updateGenerator: vi.fn(),
  };
}

const setup = () => {
  const mesh = makeMesh();
  const highlight = createSelectionHighlight(
    { mesh } as unknown as SplatSceneHandle,
    FakeRgbaArray as unknown as typeof RgbaArray,
  );
  return { mesh, highlight };
};

describe('createSelectionHighlight', () => {
  it('teinte les sélectionnés (alpha conservé), garde la base pour les autres, attache une fois', () => {
    const { mesh, highlight } = setup();
    highlight.apply(new Set([1]));
    const rgba = mesh.splatRgba as FakeRgbaArray;
    expect(rgba).toBeInstanceOf(FakeRgbaArray);
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(1);
    const a = rgba.array!;
    expect([...a.subarray(0, 4)]).toEqual([255, 0, 0, 255]); // base intacte
    expect([...a.subarray(4, 8)]).toEqual([...HIGHLIGHT_RGB, 128]); // teinte, alpha 0,5 conservé
    // Nouvelle sélection : l'ancien teinté est restauré, pas de ré-attache.
    highlight.apply(new Set([0]));
    expect([...a.subarray(0, 4)]).toEqual([...HIGHLIGHT_RGB, 255]);
    expect([...a.subarray(4, 8)]).toEqual([0, 255, 0, 128]);
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(1);
    expect(mesh.needsUpdate).toBe(true);
  });

  it('resynchronise les indices marqués dirty (masquage) au prochain apply', () => {
    const { mesh, highlight } = setup();
    highlight.apply(new Set([0]));
    mesh.splats[1].opacity = 0; // splat 1 masqué après la capture de base
    highlight.markDirty([1]);
    highlight.apply(new Set([0, 1]));
    const a = (mesh.splatRgba as FakeRgbaArray).array!;
    expect([...a.subarray(4, 8)]).toEqual([...HIGHLIGHT_RGB, 0]); // teinté mais invisible
  });

  it('détache sur sélection vide et libère à dispose', () => {
    const { mesh, highlight } = setup();
    highlight.apply(new Set([0]));
    const rgba = mesh.splatRgba as FakeRgbaArray;
    highlight.apply(new Set());
    expect(mesh.splatRgba).toBeNull();
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(2);
    highlight.dispose();
    expect(rgba.disposed).toBe(true);
  });
});
