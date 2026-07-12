import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { normalizeTransform, TARGET_SIZE } from './loadModel';

describe('loadModel.normalizeTransform — normalisation par bbox (V1)', () => {
  it('met la plus grande dimension à TARGET_SIZE et recentre à l’origine', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3));
    const n = normalizeTransform(THREE, box);
    // plus grande dimension = 6 → scale = 2/6
    expect(n.scale).toBeCloseTo(TARGET_SIZE / 6);
    // centre en (0,0,0) → aucune translation
    expect(n.position.length()).toBeCloseTo(0);
    expect(n.radius).toBeGreaterThan(0);
  });

  it('translate un modèle décentré pour ramener son centre à l’origine (après échelle)', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2));
    const n = normalizeTransform(THREE, box);
    expect(n.scale).toBeCloseTo(1); // maxDim 2 = TARGET_SIZE
    // centre (1,1,1) → position -(1,1,1)*scale
    expect(n.position.x).toBeCloseTo(-1);
    expect(n.position.y).toBeCloseTo(-1);
    expect(n.position.z).toBeCloseTo(-1);
  });

  it('gère une bbox dégénérée (échelle neutre)', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
    expect(normalizeTransform(THREE, box).scale).toBe(1);
  });
});
