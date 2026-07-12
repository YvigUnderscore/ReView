import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyRoll, rollFromUp } from './cameraRoll';

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
});
