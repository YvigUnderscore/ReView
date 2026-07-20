import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSkeletonOverlay, hasSkinnedMesh } from './skeletonOverlay';

describe('skeletonOverlay — debug squelette (40.B)', () => {
  it('détecte la présence d’un SkinnedMesh dans le sous-arbre', () => {
    const rigged = new THREE.Group();
    rigged.add(new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    expect(hasSkinnedMesh(rigged)).toBe(true);

    const plain = new THREE.Group();
    plain.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    expect(hasSkinnedMesh(plain)).toBe(false);
  });

  it('crée un overlay dessiné par-dessus le modèle (depthTest off)', () => {
    const root = new THREE.Group();
    root.add(new THREE.Bone());
    const helper = createSkeletonOverlay(THREE, root);
    const mat = helper.material as THREE.LineBasicMaterial;
    expect(mat.depthTest).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(helper.renderOrder).toBe(999);
  });
});
