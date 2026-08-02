// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';
import { applySplatTransform, parseHotspotPoint } from './meshPose';

const mesh = () => new THREE.Object3D() as unknown as SplatMesh;

describe('applySplatTransform — TRS enregistré → mesh', () => {
  it('applique position/quaternion/échelle', () => {
    const m = mesh();
    applySplatTransform(m, { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] });
    expect(m.position.toArray()).toEqual([1, 2, 3]);
    expect(m.scale.toArray()).toEqual([2, 2, 2]);
  });

  it('revient à l’identité si la valeur est absente ou invalide', () => {
    const m = mesh();
    m.position.set(5, 5, 5);
    applySplatTransform(m, null);
    expect(m.position.toArray()).toEqual([0, 0, 0]);
    applySplatTransform(m, { position: 'x' } as never);
    expect(m.scale.toArray()).toEqual([1, 1, 1]);
  });
});

describe('parseHotspotPoint — position texte → point Three', () => {
  it('interprète « x y z » et l’espace objet', () => {
    const p = parseHotspotPoint(THREE, { position: '1 2 3', normal: '0 1 0', space: 'object' });
    expect(p?.point.toArray()).toEqual([1, 2, 3]);
    expect(p?.objectSpace).toBe(true);
  });

  it('rejette une chaîne invalide', () => {
    expect(parseHotspotPoint(THREE, { position: 'a b c', normal: '0 1 0' })).toBeNull();
  });
});
