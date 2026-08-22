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

/** Bbox du modèle une fois la normalisation appliquée (échelle uniforme puis translation). */
function normalizedBox(box: THREE.Box3): THREE.Box3 {
  const n = normalizeTransform(THREE, box);
  return new THREE.Box3(
    box.min.clone().multiplyScalar(n.scale).add(n.position),
    box.max.clone().multiplyScalar(n.scale).add(n.position),
  );
}

describe('loadModel.normalizeTransform — normalisation par bbox (V1)', () => {
  it('met la plus grande dimension à TARGET_SIZE et centre horizontalement', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, -2, -3), new THREE.Vector3(1, 2, 3));
    const n = normalizeTransform(THREE, box);
    // plus grande dimension = 6 → scale = 2/6
    expect(n.scale).toBeCloseTo(TARGET_SIZE / 6);
    // centre déjà en (0,0,0) horizontalement → pas de translation en X/Z
    expect(n.position.x).toBeCloseTo(0);
    expect(n.position.z).toBeCloseTo(0);
    expect(n.radius).toBeGreaterThan(0);
  });

  it('pose le modèle sur le sol : le bas de la bbox normalisée est à y = 0', () => {
    // Modèle décentré et enfoncé sous l'origine dans le fichier source.
    const box = new THREE.Box3(new THREE.Vector3(-3, -5, 1), new THREE.Vector3(1, 3, 5));
    const result = normalizedBox(box);
    expect(result.min.y).toBeCloseTo(0);
    // Centrage horizontal conservé : le centre X/Z reste sur l'axe vertical de la scène.
    const center = result.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
  });

  it('un modèle déjà posé sur le sol dans le DCC y reste (aucun enfoncement)', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const n = normalizeTransform(THREE, box);
    expect(n.scale).toBeCloseTo(1); // maxDim 2 = TARGET_SIZE
    expect(n.position.y).toBeCloseTo(0);
    expect(normalizedBox(box).min.y).toBeCloseTo(0);
  });

  it('expose le centre réel du modèle (cadrage caméra), à mi-hauteur au-dessus du sol', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 10, 0), new THREE.Vector3(2, 14, 2));
    const n = normalizeTransform(THREE, box);
    // maxDim 4 → scale 1/2, hauteur normalisée 2 → centre à y = 1
    expect(n.scale).toBeCloseTo(0.5);
    expect(n.center.x).toBeCloseTo(0);
    expect(n.center.y).toBeCloseTo(1);
    expect(n.center.z).toBeCloseTo(0);
    expect(normalizedBox(box).getCenter(new THREE.Vector3()).y).toBeCloseTo(n.center.y);
  });

  it('gère une bbox dégénérée (échelle neutre, centre à l’origine)', () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
    const n = normalizeTransform(THREE, box);
    expect(n.scale).toBe(1);
    expect(n.center.length()).toBeCloseTo(0);
  });
});

describe('loadModel.poseForScale — bascule « taille réelle » (39.G)', () => {
  /** Bbox après application d'une pose (échelle uniforme puis translation). */
  const posed = (box: THREE.Box3, scale: number) => {
    const p = poseForScale(THREE, box, scale);
    return new THREE.Box3(
      box.min.clone().multiplyScalar(p.scale).add(p.position),
      box.max.clone().multiplyScalar(p.scale).add(p.position),
    );
  };

  it('à l’échelle 1, le modèle garde les dimensions de son fichier', () => {
    // Décor de 30 m posé au sol dans le DCC, ramené à 2 unités par la normalisation.
    const box = new THREE.Box3(new THREE.Vector3(-15, 0, -10), new THREE.Vector3(15, 8, 10));
    expect(normalizationScale(THREE, box)).toBeCloseTo(TARGET_SIZE / 30);
    const real = posed(box, 1);
    const size = real.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(30);
    expect(size.y).toBeCloseTo(8);
    // Toujours posé sur la grille et centré horizontalement, quelle que soit l'échelle.
    expect(real.min.y).toBeCloseTo(0);
    expect(real.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
  });

  it('deux objets de tailles très différentes cessent de se ressembler', () => {
    const prop = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 0.2, 0.2));
    const set = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(30, 30, 30));
    // Normalisés, les deux font TARGET_SIZE ; à l'échelle réelle, le rapport est de 150.
    expect(posed(prop, normalizationScale(THREE, prop)).getSize(new THREE.Vector3()).x).toBeCloseTo(
      posed(set, normalizationScale(THREE, set)).getSize(new THREE.Vector3()).x,
    );
    expect(
      posed(set, 1).getSize(new THREE.Vector3()).x / posed(prop, 1).getSize(new THREE.Vector3()).x,
    ).toBeCloseTo(150);
  });

  it('reste équivalente à la normalisation quand on lui passe son facteur', () => {
    const box = new THREE.Box3(new THREE.Vector3(-3, -5, 1), new THREE.Vector3(1, 3, 5));
    const n = normalizeTransform(THREE, box);
    const p = poseForScale(THREE, box, normalizationScale(THREE, box));
    expect(p.scale).toBeCloseTo(n.scale);
    expect(p.position.toArray()).toEqual(n.position.toArray());
    expect(p.radius).toBeCloseTo(n.radius);
  });
});

describe('loadModel.markDeformableMeshes — skinning fiable (40.A)', () => {
  it('désactive le frustum culling des SkinnedMesh et les compte', () => {
    const root = new THREE.Group();
    const skinned = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const plain = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    root.add(skinned, plain);
    const count = markDeformableMeshes(root);
    expect(count).toBe(1);
    expect(skinned.frustumCulled).toBe(false);
    // Un mesh statique conserve son culling (perf préservée).
    expect(plain.frustumCulled).toBe(true);
  });

  it('exempte aussi les meshes à morph targets (sans les compter comme rig)', () => {
    const root = new THREE.Group();
    const morph = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    morph.morphTargetInfluences = [0, 0];
    root.add(morph);
    const count = markDeformableMeshes(root);
    expect(count).toBe(0);
    expect(morph.frustumCulled).toBe(false);
  });
});
