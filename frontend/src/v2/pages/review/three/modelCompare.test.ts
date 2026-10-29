// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sideBySideOffsets, setObjectOpacity } from './modelCompare';

function makeObject() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  group.add(mesh);
  return { group, mat: mesh.material };
}

describe('modelCompare — 3D A/B comparison (39.E)', () => {
  it('sideBySideOffsets centers the positions', () => {
    expect(sideBySideOffsets(1, 3)).toEqual([0]);
    expect(sideBySideOffsets(2, 2)).toEqual([-1, 1]);
    expect(sideBySideOffsets(3, 2)).toEqual([-2, 0, 2]);
  });

  it('setObjectOpacity at 0.5: transparent, opacity, object visible', () => {
    const { group, mat } = makeObject();
    setObjectOpacity(group, 0.5);
    expect(mat.opacity).toBe(0.5);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(group.visible).toBe(true);
  });

  it('setObjectOpacity at 0 hides the object', () => {
    const { group } = makeObject();
    setObjectOpacity(group, 0);
    expect(group.visible).toBe(false);
  });

  it('setObjectOpacity at 1 restores an opaque render', () => {
    const { group, mat } = makeObject();
    setObjectOpacity(group, 0.2);
    setObjectOpacity(group, 1);
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(group.visible).toBe(true);
  });

  it('handles multiple materials (array)', () => {
    const group = new THREE.Group();
    const mats = [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial()];
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), mats));
    setObjectOpacity(group, 0.3);
    expect(mats[0].opacity).toBe(0.3);
    expect(mats[1].transparent).toBe(true);
  });
});
