// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  markDeformableMeshes,
  normalizationScale,
  normalizeTransform,
  poseForScale,
  TARGET_SIZE,
} from './loadModel';

/** Bounding box of the model after normalization (uniform scale, then translation). */
function normalizedBox(box: THREE.Box3): THREE.Box3 {
  const n = normalizeTransform(THREE, box);
  return new THREE.Box3(
    box.min.clone().multiplyScalar(n.scale).add(n.position),
    box.max.clone().multiplyScalar(n.scale).add(n.position),
  );
}

describe('loadModel.normalizeTransform — bbox normalization (V1)', () => {
  it('sets the largest dimension to TARGET_SIZE and centers horizontally', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3));
    const n = normalizeTransform(THREE, box);
    // largest dimension = 6 → scale = 2/6
    expect(n.scale).toBeCloseTo(TARGET_SIZE / 6);
    // center already at (0,0,0) horizontally → no X/Z translation
    expect(n.position.x).toBeCloseTo(0);
    expect(n.position.z).toBeCloseTo(0);
    expect(n.radius).toBeGreaterThan(0);
  });

  it('places the model on the ground: the bottom of the normalized bbox is at y = 0', () => {
    // Off-center model sunk below the origin in the source file.
    const box = new THREE.Box3(new THREE.Vector3(-3, -5, 1), new THREE.Vector3(1, 3, 5));
    const result = normalizedBox(box);
    expect(result.min.y).toBeCloseTo(0);
    // Horizontal centering kept: the X/Z center stays on the scene's vertical axis.
    const center = result.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
  });

  it('a model already resting on the ground in the DCC stays there (no sinking)', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const n = normalizeTransform(THREE, box);
    expect(n.scale).toBeCloseTo(1); // maxDim 2 = TARGET_SIZE
    expect(n.position.y).toBeCloseTo(0);
    expect(normalizedBox(box).min.y).toBeCloseTo(0);
  });

  it('exposes the real model center (camera framing), at mid-height above the ground', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 10, 0), new THREE.Vector3(2, 14, 2));
    const n = normalizeTransform(THREE, box);
    // maxDim 4 → scale 1/2, normalized height 2 → center at y = 1
    expect(n.scale).toBeCloseTo(0.5);
    expect(n.center.x).toBeCloseTo(0);
    expect(n.center.y).toBeCloseTo(1);
    expect(n.center.z).toBeCloseTo(0);
    expect(normalizedBox(box).getCenter(new THREE.Vector3()).y).toBeCloseTo(n.center.y);
  });

  it('handles a degenerate bbox (neutral scale, center at the origin)', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
    const n = normalizeTransform(THREE, box);
    expect(n.scale).toBe(1);
    expect(n.center.length()).toBeCloseTo(0);
  });
});

describe('loadModel.poseForScale — "real size" toggle (39.G)', () => {
  /** Bbox after applying a pose (uniform scale, then translation). */
  const posed = (box: THREE.Box3, scale: number) => {
    const p = poseForScale(THREE, box, scale);
    return new THREE.Box3(
      box.min.clone().multiplyScalar(p.scale).add(p.position),
      box.max.clone().multiplyScalar(p.scale).add(p.position),
    );
  };

  it('at scale 1, the model keeps the dimensions of its file', () => {
    // 30 m set piece on the ground in the DCC, brought down to 2 units by normalization.
    const box = new THREE.Box3(new THREE.Vector3(-15, 0, -10), new THREE.Vector3(15, 8, 10));
    expect(normalizationScale(THREE, box)).toBeCloseTo(TARGET_SIZE / 30);
    const real = posed(box, 1);
    const size = real.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(30);
    expect(size.y).toBeCloseTo(8);
    // Still on the grid and horizontally centered, whatever the scale.
    expect(real.min.y).toBeCloseTo(0);
    expect(real.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
  });

  it('two objects of very different sizes stop looking alike', () => {
    const prop = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 0.2, 0.2));
    const set = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 30, 30));
    // Normalized, both are TARGET_SIZE; at real scale, the ratio is 150.
    expect(posed(prop, normalizationScale(THREE, prop)).getSize(new THREE.Vector3()).x).toBeCloseTo(
      posed(set, normalizationScale(THREE, set)).getSize(new THREE.Vector3()).x,
    );
    expect(
      posed(set, 1).getSize(new THREE.Vector3()).x / posed(prop, 1).getSize(new THREE.Vector3()).x,
    ).toBeCloseTo(150);
  });

  it('stays equivalent to normalization when given its factor', () => {
    const box = new THREE.Box3(new THREE.Vector3(-3, -5, 1), new THREE.Vector3(1, 3, 5));
    const n = normalizeTransform(THREE, box);
    const p = poseForScale(THREE, box, normalizationScale(THREE, box));
    expect(p.scale).toBeCloseTo(n.scale);
    expect(p.position.toArray()).toEqual(n.position.toArray());
    expect(p.radius).toBeCloseTo(n.radius);
  });
});

describe('loadModel.markDeformableMeshes — reliable skinning (40.A)', () => {
  it('disables frustum culling on SkinnedMesh and counts them', () => {
    const root = new THREE.Group();
    const skinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const plain = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    root.add(skinned, plain);
    const count = markDeformableMeshes(root);
    expect(count).toBe(1);
    expect(skinned.frustumCulled).toBe(false);
    // A static mesh keeps its culling (performance preserved).
    expect(plain.frustumCulled).toBe(true);
  });

  it('also exempts morph-target meshes (without counting them as a rig)', () => {
    const root = new THREE.Group();
    const morph = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    morph.morphTargetInfluences = [0, 0];
    root.add(morph);
    const count = markDeformableMeshes(root);
    expect(count).toBe(0);
    expect(morph.frustumCulled).toBe(false);
  });
});
