import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { captureModelCamera, orbitToPosition, restoreModelCamera } from './modelCamera';

describe('modelCamera — capture/restauration de vue (V5)', () => {
  it('orbitToPosition : orbite model-viewer → cartésien autour de la cible', () => {
    // phi=90° (équateur), theta=0 → +Z ; rayon 5, cible origine.
    const p = orbitToPosition(THREE, { theta: 0, phi: Math.PI / 2, radius: 5 }, { x: 0, y: 0, z: 0 });
    expect(p.z).toBeCloseTo(5);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
    // theta=90° → +X
    const q = orbitToPosition(
      THREE,
      { theta: Math.PI / 2, phi: Math.PI / 2, radius: 5 },
      { x: 0, y: 0, z: 0 },
    );
    expect(q.x).toBeCloseTo(5);
  });

  it('capture position + cible + fov', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(1, 2, 3);
    const controls = { target: new THREE.Vector3(4, 5, 6) } as never;
    const s = captureModelCamera(THREE, camera, controls);
    expect(s.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(s.target).toEqual({ x: 4, y: 5, z: 6 });
    expect(s.fov).toBe(50);
  });

  it('restaure un état position (nouveau format)', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const update = vi.fn();
    const controls = { target: new THREE.Vector3(), update } as never;
    restoreModelCamera(THREE, camera, controls, {
      position: { x: 7, y: 8, z: 9 },
      target: { x: 1, y: 0, z: 0 },
      fov: 35,
    });
    expect(camera.position.toArray()).toEqual([7, 8, 9]);
    expect(camera.fov).toBe(35);
    expect(update).toHaveBeenCalled();
  });

  it('restaure un état orbite hérité (model-viewer)', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const controls = { target: new THREE.Vector3(), update: vi.fn() } as never;
    restoreModelCamera(THREE, camera, controls, {
      orbit: { theta: 0, phi: Math.PI / 2, radius: 4 },
      target: { x: 0, y: 0, z: 0 },
    });
    expect(camera.position.z).toBeCloseTo(4);
  });

  it('état inexploitable : no-op', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(1, 1, 1);
    const controls = { target: new THREE.Vector3(), update: vi.fn() } as never;
    restoreModelCamera(THREE, camera, controls, null);
    restoreModelCamera(THREE, camera, controls, {});
    expect(camera.position.toArray()).toEqual([1, 1, 1]);
  });
});
