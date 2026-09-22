// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { focusObjectPoint, poiFocusRadius, POI_FOCUS_RATIO } from './poiFocus';

/** OrbitControls réduit à ce que le cadrage lit et écrit : sa cible et son `update`. */
function controlsStub() {
  let updates = 0;
  const controls = {
    target: new THREE.Vector3(0, 0, 0),
    update: () => {
      updates += 1;
    },
  };
  return { controls: controls as unknown as OrbitControls, target: controls.target, calls: () => updates };
}

function rig() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  const object = new THREE.Group();
  return { camera, object, ...controlsStub() };
}

describe('poiFocusRadius — un point n’a pas de taille, le cadrage lui en donne une', () => {
  it('prend une fraction de la scène, jamais zéro', () => {
    expect(poiFocusRadius(10)).toBeCloseTo(10 * POI_FOCUS_RATIO);
    expect(poiFocusRadius(0)).toBeGreaterThan(0);
    expect(poiFocusRadius(Number.NaN)).toBeGreaterThan(0);
  });
});

describe('focusObjectPoint — le numéro cliqué ramène la caméra sur son point', () => {
  it('cadre sur le point, en conservant la direction de vue', () => {
    const { camera, object, controls, target } = rig();
    const ok = focusObjectPoint({
      three: THREE,
      camera,
      controls,
      object,
      point: { position: '2 1 0', normal: '0 0 1', space: 'object' },
      sceneRadius: 4,
    });
    expect(ok).toBe(true);
    expect(target.toArray()).toEqual([2, 1, 0]);
    // La caméra reste du même côté (elle regardait depuis +Z) et s'approche du point.
    expect(camera.position.z).toBeGreaterThan(0);
    expect(camera.position.x).toBeCloseTo(2);
  });

  it('applique la matrice monde de l’objet : le rejeu vaut pour tout spectateur', () => {
    const { camera, object, controls, target } = rig();
    object.position.set(5, 0, 0);
    object.updateMatrixWorld(true);
    focusObjectPoint({
      three: THREE,
      camera,
      controls,
      object,
      point: { position: '2 0 0', normal: '0 0 1', space: 'object' },
      sceneRadius: 4,
    });
    // Point local 2 + objet décalé de 5 → le cadrage vise 7 en monde.
    expect(target.x).toBeCloseTo(7);
  });

  it('laisse un point en espace MONDE là où il est (annotation d’avant l’espace objet)', () => {
    const { camera, object, controls, target } = rig();
    object.position.set(5, 0, 0);
    object.updateMatrixWorld(true);
    focusObjectPoint({
      three: THREE,
      camera,
      controls,
      object,
      point: { position: '2 0 0', normal: '0 0 1' },
      sceneRadius: 4,
    });
    expect(target.x).toBeCloseTo(2);
  });

  it('ne bouge rien si la position est illisible', () => {
    const { camera, object, controls, target, calls } = rig();
    const ok = focusObjectPoint({
      three: THREE,
      camera,
      controls,
      object,
      point: { position: 'x y z', normal: '0 0 1' },
      sceneRadius: 4,
    });
    expect(ok).toBe(false);
    expect(target.toArray()).toEqual([0, 0, 0]);
    expect(calls()).toBe(0);
  });
});
