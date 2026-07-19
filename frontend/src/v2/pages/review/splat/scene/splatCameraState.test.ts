import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { captureSplatCamera, restoreSplatCamera } from './splatCameraState';

// Comme OrbitControls : update() oriente la caméra vers la cible (lookAt, up courant).
const makeControls = (camera: THREE.PerspectiveCamera, target: THREE.Vector3) =>
  ({ target, update: () => camera.lookAt(target) }) as never;

describe('splatCameraState — capture/restauration avec tilt (roll)', () => {
  it('capture position/cible/fov et omet le roll si horizon droit', () => {
    const camera = new THREE.PerspectiveCamera(55, 1.5, 0.1, 100);
    camera.position.set(0, 0, 5);
    const controls = makeControls(camera, new THREE.Vector3(0, 0, 0));
    const cam = captureSplatCamera(THREE, camera, controls);
    expect(cam.position).toEqual({ x: 0, y: 0, z: 5 });
    expect(cam.target.x).toBeCloseTo(0);
    expect(cam.target.y).toBeCloseTo(0);
    expect(cam.target.z).toBeCloseTo(0);
    expect(cam.fov).toBe(55);
    expect(cam.roll).toBeUndefined(); // up par défaut → pas de roll
  });

  it('vol (controls gelés) : la capture suit la rotation réelle de la caméra', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 5);
    // Cible d'orbite obsolète (le vol ne la recale qu'au relâchement) : à (0,0,0).
    const controls = makeControls(camera, new THREE.Vector3(0, 0, 0));
    // Regard tourné de 90° vers la gauche (quaternion seul, comme flyControls).
    camera.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'YXZ'));
    const cam = captureSplatCamera(THREE, camera, controls);
    // La cible capturée est reprojetée devant la caméra (distance d'orbite = 5) : en -X.
    expect(cam.target.x).toBeCloseTo(-5);
    expect(cam.target.y).toBeCloseTo(0);
    expect(cam.target.z).toBeCloseTo(5);
  });

  it('restaure position/cible/fov et applique le roll (up incliné)', () => {
    const camera = new THREE.PerspectiveCamera();
    const controls = makeControls(camera, new THREE.Vector3());
    restoreSplatCamera(THREE, camera, controls, {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      fov: 40,
      roll: Math.PI / 2,
    });
    expect(camera.position.z).toBe(5);
    expect(camera.fov).toBe(40);
    expect(Math.abs(camera.up.x)).toBeCloseTo(1); // roll π/2 → up ≈ ±X
  });

  it('round-trip du roll (capture après restauration)', () => {
    const camera = new THREE.PerspectiveCamera();
    const controls = makeControls(camera, new THREE.Vector3());
    restoreSplatCamera(THREE, camera, controls, {
      position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 },
      roll: 0.6,
    });
    expect(captureSplatCamera(THREE, camera, controls).roll).toBeCloseTo(0.6);
  });

  it('état inexploitable : no-op', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 1, 1);
    restoreSplatCamera(THREE, camera, makeControls(camera, new THREE.Vector3()), null);
    expect(camera.position.toArray()).toEqual([1, 1, 1]);
  });
});
