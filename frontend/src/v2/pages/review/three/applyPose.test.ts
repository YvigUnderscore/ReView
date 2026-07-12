import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyPoseToCamera } from './applyPose';

describe('applyPoseToCamera — pose sur caméra libre (PiP layout)', () => {
  it('positionne la caméra et l’oriente vers la cible', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    applyPoseToCamera(THREE, camera, {
      position: { x: 0, y: 0, z: 10 },
      target: { x: 0, y: 0, z: 0 },
      fov: 35,
    });
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
    expect(camera.fov).toBe(35);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeCloseTo(-1); // regarde vers -Z (la cible)
  });

  it('applique le roll (up incliné) sans dévier la direction de vue', () => {
    const camera = new THREE.PerspectiveCamera();
    applyPoseToCamera(THREE, camera, {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      roll: Math.PI / 2,
    });
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeCloseTo(-1); // direction inchangée
    expect(Math.abs(camera.up.x)).toBeCloseTo(1); // up basculé (roll)
  });
});
