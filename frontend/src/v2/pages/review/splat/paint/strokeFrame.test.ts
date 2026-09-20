// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import type { SplatSceneHandle } from '../useSplat';
import { GHOST_OPACITY, attachStrokeFrame, ghostOpacity } from './strokeFrame';

/** Entretien par image, appelé avec le minimum dont il se sert réellement. */
type Upkeep = (
  renderer: { getSize: (target: THREE.Vector2) => THREE.Vector2 },
  scene: unknown,
  camera: THREE.Camera,
) => void;

function fakeLine() {
  const line = {
    material: { resolution: new THREE.Vector2(), opacity: 1 },
    onBeforeRender: () => {},
  };
  return line as unknown as Line2 & { material: { resolution: THREE.Vector2; opacity: number } };
}

function fakeHandle(meshPosition: THREE.Vector3 = new THREE.Vector3()) {
  const mesh = new THREE.Object3D();
  mesh.position.copy(meshPosition);
  mesh.updateMatrixWorld(true);
  return { THREE, mesh } as unknown as SplatSceneHandle;
}

const renderer = { getSize: (target: THREE.Vector2) => target.set(1280, 720) };

function cameraAt(x: number, y: number, z: number) {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
  camera.position.set(x, y, z);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('ghostOpacity', () => {
  it('pleine opacité face au trait, fantôme derrière, rampe entre les deux', () => {
    expect(ghostOpacity(1)).toBe(1);
    expect(ghostOpacity(0.1)).toBe(1);
    expect(ghostOpacity(-0.2)).toBe(GHOST_OPACITY);
    expect(ghostOpacity(-1)).toBe(GHOST_OPACITY);
    const middle = ghostOpacity(-0.05);
    expect(middle).toBeGreaterThan(GHOST_OPACITY);
    expect(middle).toBeLessThan(1);
    expect(middle).toBeCloseTo(GHOST_OPACITY + 0.5 * (1 - GHOST_OPACITY), 6);
  });

  it('croît sans redescendre sur toute la rampe', () => {
    let previous = -1;
    for (let facing = -0.3; facing <= 0.2; facing += 0.01) {
      const value = ghostOpacity(facing);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('attachStrokeFrame', () => {
  it('donne la taille de la vue au matériau — sans elle, l’épaisseur en pixels est fausse', () => {
    const line = fakeLine();
    attachStrokeFrame(line, fakeHandle(), null, [0, 0, 0]);
    (line.onBeforeRender as unknown as Upkeep)(renderer, null, cameraAt(0, 0, 10));
    expect(line.material.resolution.x).toBe(1280);
    expect(line.material.resolution.y).toBe(720);
  });

  it('laisse un trait sans normale pleinement visible (traits d’avant l’occlusion)', () => {
    const line = fakeLine();
    attachStrokeFrame(line, fakeHandle(), null, [0, 0, 0]);
    (line.onBeforeRender as unknown as Upkeep)(renderer, null, cameraAt(0, 0, -10));
    expect(line.material.opacity).toBe(1);
  });

  it('estompe le trait quand la caméra passe derrière la face peinte', () => {
    const line = fakeLine();
    // Trait peint depuis +z : sa normale objet pointe vers +z.
    attachStrokeFrame(line, fakeHandle(), [0, 0, 1], [0, 0, 0]);
    const upkeep = line.onBeforeRender as unknown as Upkeep;
    upkeep(renderer, null, cameraAt(0, 0, 10));
    expect(line.material.opacity).toBe(1);
    upkeep(renderer, null, cameraAt(0, 0, -10));
    expect(line.material.opacity).toBe(GHOST_OPACITY);
  });

  it('mesure en espace objet : la transformation du média ne renverse pas l’occlusion', () => {
    const line = fakeLine();
    // Le mesh est déplacé de 100 en x ; le trait, lui, vit en espace objet en (0,0,0).
    attachStrokeFrame(line, fakeHandle(new THREE.Vector3(100, 0, 0)), [0, 0, 1], [0, 0, 0]);
    const upkeep = line.onBeforeRender as unknown as Upkeep;
    upkeep(renderer, null, cameraAt(100, 0, 10));
    expect(line.material.opacity).toBe(1);
    upkeep(renderer, null, cameraAt(100, 0, -10));
    expect(line.material.opacity).toBe(GHOST_OPACITY);
  });
});
