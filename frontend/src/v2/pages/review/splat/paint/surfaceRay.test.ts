// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SplatSceneHandle } from '../useSplat';
import { makeProjector, raycastSurface } from './surfaceRay';

/**
 * Le nuage est remplacé par un **plan** : `SplatMesh.raycast` est la seule chose que la brosse
 * lui demande, et un plan la satisfait exactement comme une surface réelle. Rien ici ne touche
 * au GPU — `Raycaster`, `Matrix4` et la caméra sont du calcul pur.
 */
const VIEWPORT = { width: 200, height: 200 };

function fakeHandle(meshPosition = new THREE.Vector3(), planeZ = 0) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const mesh = new THREE.Object3D();
  mesh.position.copy(meshPosition);
  mesh.updateMatrixWorld(true);
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
  Object.assign(mesh, {
    raycast: (
      raycaster: THREE.Raycaster,
      hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[],
    ) => {
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      hits.push({ distance: raycaster.ray.origin.distanceTo(point), point, object: mesh });
    },
  });
  return { THREE, camera, mesh } as unknown as SplatSceneHandle;
}

describe('raycastSurface', () => {
  it('touche la surface au centre de la vue et rend le point en espace monde ET objet', () => {
    const sample = raycastSurface(fakeHandle(), [100, 100], VIEWPORT, 6);
    expect(sample).not.toBeNull();
    expect(sample!.world[0]).toBeCloseTo(0, 5);
    expect(sample!.world[1]).toBeCloseTo(0, 5);
    expect(sample!.world[2]).toBeCloseTo(0, 5);
    expect(sample!.depth).toBeCloseTo(10, 5);
    expect(sample!.screenStep).toBe(6);
  });

  it('ramène le point en espace objet quand le média est transformé', () => {
    // Mesh décalé de 3 en x : le point du monde (0,0,0) vaut (-3,0,0) en espace objet.
    const sample = raycastSurface(fakeHandle(new THREE.Vector3(3, 0, 0)), [100, 100], VIEWPORT, 0);
    expect(sample!.world[0]).toBeCloseTo(0, 5);
    expect(sample!.object[0]).toBeCloseTo(-3, 5);
  });

  it('oriente la normale approchée vers la caméra, en espace objet', () => {
    const sample = raycastSurface(fakeHandle(), [100, 100], VIEWPORT, 0);
    expect(sample!.toCamera[2]).toBeCloseTo(1, 5);
    expect(Math.hypot(...sample!.toCamera)).toBeCloseTo(1, 5);
  });

  it('renvoie null quand le rayon ne touche rien (le trait s’arrête là)', () => {
    const handle = fakeHandle();
    // Plan parallèle au rayon central : aucune intersection.
    Object.assign(handle.mesh, { raycast: () => {} });
    expect(raycastSurface(handle, [100, 100], VIEWPORT, 0)).toBeNull();
  });
});

describe('makeProjector', () => {
  it('projette le centre de l’objet au centre de la vue', () => {
    const project = makeProjector(fakeHandle(), VIEWPORT);
    const screen = project(0, 0, 0);
    expect(screen).not.toBeNull();
    expect(screen![0]).toBeCloseTo(100, 4);
    expect(screen![1]).toBeCloseTo(100, 4);
  });

  it('descend à l’écran quand le point descend dans la scène', () => {
    const project = makeProjector(fakeHandle(), VIEWPORT);
    const up = project(0, 1, 0)!;
    const down = project(0, -1, 0)!;
    expect(up[1]).toBeLessThan(100);
    expect(down[1]).toBeGreaterThan(100);
  });

  it('refuse un point derrière la caméra au lieu de rendre un pixel plausible', () => {
    const project = makeProjector(fakeHandle(), VIEWPORT);
    expect(project(0, 0, 20)).toBeNull();
  });
});
