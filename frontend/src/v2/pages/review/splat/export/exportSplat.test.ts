import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SpzReader } from '@sparkjsdev/spark';
import type { SplatSceneHandle } from '../useSplat';
import { buildCleanSpz, cleanExportName } from './exportSplat';

/** Faux handle minimal : seuls `THREE` et `mesh.packedSplats.forEachSplat` sont lus par l'export. */
function fakeHandle(raws: { center: [number, number, number]; opacity: number }[]): SplatSceneHandle {
  const packedSplats = {
    forEachSplat: (
      cb: (
        i: number,
        c: THREE.Vector3,
        s: THREE.Vector3,
        q: THREE.Quaternion,
        o: number,
        col: THREE.Color,
      ) => void,
    ) =>
      raws.forEach((r, i) =>
        cb(
          i,
          new THREE.Vector3().fromArray(r.center),
          new THREE.Vector3(0.1, 0.1, 0.1),
          new THREE.Quaternion(),
          r.opacity,
          new THREE.Color(0.5, 0.5, 0.5),
        ),
      ),
  };
  return { THREE, mesh: { packedSplats } } as unknown as SplatSceneHandle;
}

describe('cleanExportName', () => {
  it('remplace l’extension par le suffixe .spz', () => {
    expect(cleanExportName('scene.ply')).toBe('scene-nettoye.spz');
    expect(cleanExportName('ma capture.spz')).toBe('ma capture-nettoye.spz');
  });
  it('gère l’absence d’extension et le vide', () => {
    expect(cleanExportName('scene')).toBe('scene-nettoye.spz');
    expect(cleanExportName('')).toBe('splat-nettoye.spz');
  });
});

describe('buildCleanSpz', () => {
  it('exporte les splats visibles et compte ceux gardés', async () => {
    const handle = fakeHandle([
      { center: [0, 0, 0], opacity: 1 },
      { center: [1, 0, 0], opacity: 0 }, // masqué → exclu
      { center: [2, 0, 0], opacity: 1 },
    ]);
    const { bytes, kept } = await buildCleanSpz(handle, { transform: null, volumes: [] });
    expect(kept).toBe(2);
    const reader = new SpzReader({ fileBytes: bytes });
    await reader.parseHeader();
    expect(reader.numSplats).toBe(2);
  });

  it('lève si tous les splats sont masqués', async () => {
    const handle = fakeHandle([{ center: [0, 0, 0], opacity: 0 }]);
    await expect(buildCleanSpz(handle, { transform: null, volumes: [] })).rejects.toThrow();
  });
});
