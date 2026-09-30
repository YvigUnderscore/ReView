// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyRoll, rollFromCamera, rollFromUp, rollOrientation, updateOrbitKeepingRoll } from './cameraRoll';

describe('cameraRoll — tilt via camera.up (mode layout)', () => {
  it('roll 0 : up = +Y (horizon droit) pour une vue horizontale', () => {
    const camera = new THREE.PerspectiveCamera();
    applyRoll(THREE, camera, new THREE.Vector3(0, 0, -1), 0);
    expect(camera.up.x).toBeCloseTo(0);
    expect(camera.up.y).toBeCloseTo(1);
    expect(camera.up.z).toBeCloseTo(0);
  });

  it('roll π/2 : up bascule à ±X (rotation autour de la vue)', () => {
    const camera = new THREE.PerspectiveCamera();
    applyRoll(THREE, camera, new THREE.Vector3(0, 0, -1), Math.PI / 2);
    expect(Math.abs(camera.up.x)).toBeCloseTo(1);
    expect(camera.up.y).toBeCloseTo(0);
  });

  it('round-trip : rollFromUp retrouve le roll appliqué', () => {
    const camera = new THREE.PerspectiveCamera();
    const forward = new THREE.Vector3(1, -0.5, -1);
    for (const roll of [0, 0.3, -0.8, 1.2]) {
      applyRoll(THREE, camera, forward, roll);
      expect(rollFromUp(THREE, forward, camera.up)).toBeCloseTo(roll);
    }
  });

  it('vue verticale : up non dégénéré (bascule sur +Z)', () => {
    const camera = new THREE.PerspectiveCamera();
    applyRoll(THREE, camera, new THREE.Vector3(0, -1, 0), 0);
    expect(camera.up.length()).toBeCloseTo(1);
  });

  it('roll 0 : restaure le up monde quel que soit l’axe de vue (Phase 26, fix tilt)', () => {
    const camera = new THREE.PerspectiveCamera();
    // Un roll non nul a figé un up penché ; revenir à 0 doit rendre (0,1,0), pas un up projeté.
    const forward = new THREE.Vector3(1, -0.5, -1);
    applyRoll(THREE, camera, forward, 0.7);
    applyRoll(THREE, camera, forward, 0);
    expect(camera.up.x).toBe(0);
    expect(camera.up.y).toBe(1);
    expect(camera.up.z).toBe(0);
  });
});

/**
 * Orbite : `OrbitControls.update()` ne fait, pour ce qui concerne le tilt, qu'une chose —
 * `object.lookAt(target)` après avoir replacé la position sur sa sphère. Le faux contrôleur
 * ci-dessous reproduit exactement ces deux gestes ; c'est ce qui suffit à observer la dérive.
 */
function fakeControls(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
  return { target, update: () => camera.lookAt(target) };
}

/** Fait tourner la caméra autour de sa cible (ce que produit un drag au clic gauche). */
function orbit(camera: THREE.PerspectiveCamera, target: THREE.Vector3, angle: number): void {
  const offset = camera.position
    .clone()
    .sub(target)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  camera.position.copy(target).add(offset);
}

describe('cameraRoll — le tilt à travers l’orbite', () => {
  const setup = (roll: number) => {
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Vector3(0, 0, 0);
    camera.position.set(0, 2, 6);
    const controls = fakeControls(camera, target);
    applyRoll(THREE, camera, target.clone().sub(camera.position), roll);
    controls.update();
    return { camera, target, controls };
  };

  it('le `up` figé d’`applyRoll` fait DÉRIVER le tilt dès qu’on orbite (le défaut)', () => {
    const { camera, target, controls } = setup(0.5);
    expect(rollFromCamera(THREE, camera)).toBeCloseTo(0.5);
    orbit(camera, target, Math.PI / 3);
    controls.update(); // orbite nue : `lookAt` relit le `up` penché, devenu obsolète
    expect(Math.abs(rollFromCamera(THREE, camera) - 0.5)).toBeGreaterThan(0.05);
  });

  it('`updateOrbitKeepingRoll` garde le tilt réglé, quart de tour après quart de tour', () => {
    const { camera, target, controls } = setup(0.5);
    for (let i = 0; i < 8; i++) {
      orbit(camera, target, Math.PI / 4);
      updateOrbitKeepingRoll(THREE, camera, controls);
      expect(rollFromCamera(THREE, camera)).toBeCloseTo(0.5);
    }
    // Et le `up` est reparti à plat : c'est l'orientation qui porte le tilt, plus un vecteur monde.
    expect(camera.up.y).toBeCloseTo(1);
  });

  it('tilt nul : l’orbite reste exactement celle d’avant (aucune recomposition)', () => {
    const { camera, target, controls } = setup(0);
    orbit(camera, target, 0.7);
    updateOrbitKeepingRoll(THREE, camera, controls);
    const kept = camera.quaternion.clone();
    camera.lookAt(target); // ce que ferait `controls.update()` seul
    expect(kept.angleTo(camera.quaternion)).toBeCloseTo(0);
  });

  it('caméra confondue avec sa cible : orbite nue, aucun NaN', () => {
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Vector3(1, 1, 1);
    camera.position.copy(target);
    applyRoll(THREE, camera, new THREE.Vector3(0, 0, -1), 0.4);
    updateOrbitKeepingRoll(THREE, camera, fakeControls(camera, target));
    expect(Number.isFinite(camera.quaternion.x)).toBe(true);
    expect(Number.isFinite(camera.up.y)).toBe(true);
  });
});

describe('cameraRoll — roulis dans l’orientation', () => {
  it('`rollOrientation` après un `lookAt` à plat = `lookAt` avec le `up` d’`applyRoll`', () => {
    const target = new THREE.Vector3(2, -1, 0);
    for (const roll of [0.3, -0.8, 1.2]) {
      const viaUp = new THREE.PerspectiveCamera();
      viaUp.position.set(-3, 4, 5);
      applyRoll(THREE, viaUp, target.clone().sub(viaUp.position), roll);
      viaUp.lookAt(target);

      const viaOrientation = new THREE.PerspectiveCamera();
      viaOrientation.position.copy(viaUp.position);
      viaOrientation.lookAt(target); // up = +Y : orientation sans roulis
      rollOrientation(THREE, viaOrientation, roll);

      expect(viaUp.quaternion.angleTo(viaOrientation.quaternion)).toBeCloseTo(0);
    }
  });

  it('`rollFromCamera` lit le tilt affiché, que le roulis vienne du `up` ou de l’orientation', () => {
    const target = new THREE.Vector3(0, 0, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(4, 1, -2);
    camera.lookAt(target);
    rollOrientation(THREE, camera, -0.6);
    expect(rollFromCamera(THREE, camera)).toBeCloseTo(-0.6);
  });

  it('roulis négligeable : l’orientation n’est pas touchée', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.lookAt(new THREE.Vector3(1, 0, -3));
    const before = camera.quaternion.clone();
    rollOrientation(THREE, camera, 1e-9);
    rollOrientation(THREE, camera, Number.NaN);
    expect(camera.quaternion.equals(before)).toBe(true);
  });
});
