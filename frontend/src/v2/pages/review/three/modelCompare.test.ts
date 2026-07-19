import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sideBySideOffsets, setObjectOpacity } from './modelCompare';

function makeObject() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  group.add(mesh);
  return { group, mat: mesh.material as THREE.MeshStandardMaterial };
}

describe('modelCompare — comparaison A/B 3D (39.E)', () => {
  it('sideBySideOffsets centre les positions', () => {
    expect(sideBySideOffsets(1, 3)).toEqual([0]);
    expect(sideBySideOffsets(2, 2)).toEqual([-1, 1]);
    expect(sideBySideOffsets(3, 2)).toEqual([-2, 0, 2]);
  });

  it('setObjectOpacity à 0.5 : transparent, opacité, objet visible', () => {
    const { group, mat } = makeObject();
    setObjectOpacity(group, 0.5);
    expect(mat.opacity).toBe(0.5);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(group.visible).toBe(true);
  });

  it('setObjectOpacity à 0 masque l’objet', () => {
    const { group } = makeObject();
    setObjectOpacity(group, 0);
    expect(group.visible).toBe(false);
  });

  it('setObjectOpacity à 1 rétablit un rendu opaque', () => {
    const { group, mat } = makeObject();
    setObjectOpacity(group, 0.2);
    setObjectOpacity(group, 1);
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false);
    expect(mat.depthWrite).toBe(true);
    expect(group.visible).toBe(true);
  });

  it('gère les matériaux multiples (tableau)', () => {
    const group = new THREE.Group();
    const mats = [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial()];
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), mats));
    setObjectOpacity(group, 0.3);
    expect(mats[0].opacity).toBe(0.3);
    expect(mats[1].transparent).toBe(true);
  });
});
