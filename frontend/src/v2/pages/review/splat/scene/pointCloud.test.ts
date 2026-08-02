// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import { createPointCloud } from './pointCloud';

/** Mesh factice : N splats de couleur/opacité données (index = ordre). */
function makeMesh(
  splats: Array<{ pos: [number, number, number]; rgb: [number, number, number]; opacity: number }>,
) {
  return {
    packedSplats: { numSplats: splats.length },
    forEachSplat(cb: (i: number, c: THREE.Vector3, s: null, q: null, o: number, col: THREE.Color) => void) {
      splats.forEach((sp, i) =>
        cb(i, new THREE.Vector3(...sp.pos), null, null, sp.opacity, new THREE.Color(...sp.rgb)),
      );
    },
  } as unknown as SplatMesh;
}

const posOf = (points: THREE.Points) => points.geometry.getAttribute('position').array as Float32Array;
const colOf = (points: THREE.Points) => points.geometry.getAttribute('color').array as Float32Array;

describe('pointCloud — overlay réactif du mode points', () => {
  it('escamote (NaN) les splats déjà masqués à la construction', () => {
    const mesh = makeMesh([
      { pos: [0, 0, 0], rgb: [1, 0, 0], opacity: 1 },
      { pos: [1, 1, 1], rgb: [0, 1, 0], opacity: 0 }, // masqué
    ]);
    const pc = createPointCloud(THREE, mesh);
    const pos = posOf(pc.points);
    expect(pos[0]).toBe(0);
    expect(Number.isNaN(pos[3])).toBe(true); // splat masqué escamoté
  });

  it('teinte la sélection puis restaure la couleur d’origine à la désélection', () => {
    const mesh = makeMesh([
      { pos: [0, 0, 0], rgb: [0.2, 0.2, 0.2], opacity: 1 },
      { pos: [1, 0, 0], rgb: [0.4, 0.4, 0.4], opacity: 1 },
    ]);
    const pc = createPointCloud(THREE, mesh);
    pc.setSelection(new Set([1]));
    const col = colOf(pc.points);
    expect(col[3]).toBeCloseTo(1); // rouge de la teinte #ffaa33
    expect(col[4]).toBeCloseTo(170 / 255);
    expect(col[0]).toBeCloseTo(0.2); // splat 0 inchangé
    pc.setSelection(new Set()); // désélection : couleur d'origine restaurée
    expect(colOf(pc.points)[3]).toBeCloseTo(0.4);
  });

  it('masque et rétablit un point (suppression / undo) via NaN', () => {
    const mesh = makeMesh([{ pos: [5, 6, 7], rgb: [1, 1, 1], opacity: 1 }]);
    const pc = createPointCloud(THREE, mesh);
    pc.setHidden([0], true);
    expect(Number.isNaN(posOf(pc.points)[0])).toBe(true);
    pc.setHidden([0], false); // undo : centre d'origine restauré
    expect(posOf(pc.points)[0]).toBe(5);
    expect(posOf(pc.points)[2]).toBe(7);
  });
});
