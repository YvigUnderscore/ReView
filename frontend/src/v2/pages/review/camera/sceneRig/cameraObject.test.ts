// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { renderWithoutHelpers } from '../../viewer/sceneHelpers';
import { createCameraObject } from './cameraObject';

/**
 * Le retour visuel de la caméra-objet : vue de la caméra libre en toutes circonstances, absente de
 * la passe PiP. Le reste de la pose est testé dans `poseObject.test.ts`.
 */

/** Tous les matériaux de l'objet (corps, frustum, marqueur, trajectoire). */
function materials(scene: THREE.Scene): THREE.Material[] {
  const out: THREE.Material[] = [];
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) out.push(...(Array.isArray(m) ? m : [m]));
  });
  return out;
}

describe('cameraObject — l’artiste doit la voir', () => {
  it('dessinée par-dessus la scène (dans un nuage de splats, la profondeur l’effaçait)', () => {
    const scene = new THREE.Scene();
    const obj = createCameraObject(THREE, scene, 1);
    const mats = materials(scene);
    expect(mats.length).toBeGreaterThan(3);
    for (const m of mats) {
      expect(m.depthTest).toBe(false);
      expect(m.depthWrite).toBe(false);
      expect(m.transparent).toBe(true); // passe des transparents : après les splats
    }
    obj.dispose();
  });

  it('ordre de rendu posé sur CHAQUE objet dessiné, pas sur le seul groupe', () => {
    const scene = new THREE.Scene();
    const obj = createCameraObject(THREE, scene, 1);
    const drawn: number[] = [];
    // Le corps est un `Group` : Three lit `renderOrder` sur l'objet rendu, pas sur son parent.
    obj.body.traverse((o) => {
      if (o !== obj.body) drawn.push(o.renderOrder);
    });
    expect(drawn.length).toBeGreaterThan(1);
    for (const order of drawn) expect(order).toBe(obj.targetMarker.renderOrder);
    obj.dispose();
  });

  it('déclarée objet d’aide : masquée pendant la passe PiP, restaurée après', () => {
    const scene = new THREE.Scene();
    const obj = createCameraObject(THREE, scene, 1);
    obj.setVisible(true);
    obj.setTrajectory([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
    const seen: boolean[] = [];
    renderWithoutHelpers(() => seen.push(obj.body.visible, obj.targetMarker.visible));
    expect(seen).toEqual([false, false]);
    expect(obj.body.visible).toBe(true);
    expect(obj.targetMarker.visible).toBe(true);
    obj.dispose();
  });

  it('démontée, elle ne pèse plus sur la passe PiP', () => {
    const scene = new THREE.Scene();
    const obj = createCameraObject(THREE, scene, 1);
    const { body } = obj;
    obj.dispose();
    body.visible = true;
    renderWithoutHelpers(() => expect(body.visible).toBe(true));
  });
});
