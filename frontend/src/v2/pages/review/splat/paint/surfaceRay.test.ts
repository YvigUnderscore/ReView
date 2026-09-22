// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeProjector, paintHandle, raycastSurface, type PaintSceneHandle } from './surfaceRay';

/**
 * Le nuage est remplacé par un **plan** : `SplatMesh.raycast` est la seule chose que la brosse
 * lui demande, et un plan la satisfait exactement comme une surface réelle. Rien ici ne touche
 * au GPU — `Raycaster`, `Matrix4` et la caméra sont du calcul pur.
 *
 * Depuis le lot 13 la brosse sert aussi le modèle 3D : le second jeu de cas décrit la différence
 * — un nuage répond au rayon lui-même, un modèle porte sa géométrie dans ses enfants.
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
  return { THREE, camera, mesh } as unknown as PaintSceneHandle;
}

/** Objet dont le raycast pose un point à `z`, à la façon d'une surface plane. */
function planeAt(z: number, name: string) {
  const object = new THREE.Object3D();
  object.name = name;
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  Object.assign(object, {
    raycast: (
      raycaster: THREE.Raycaster,
      hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[],
    ) => {
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      hits.push({ distance: raycaster.ray.origin.distanceTo(point), point, object });
    },
  });
  return object;
}

/**
 * Poignée d'un **modèle** : `mesh` est le groupe racine (espace des traits, comme côté splat) et
 * `modelObject` l'objet du modèle chargé — c'est lui, et lui seul, que le rayon interroge.
 */
function fakeModelHandle() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const mesh = new THREE.Object3D();
  const modelObject = new THREE.Object3D();
  mesh.add(modelObject);
  mesh.updateMatrixWorld(true);
  return { THREE, camera, mesh, modelObject } as unknown as PaintSceneHandle;
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

describe('surface peinte d’un modèle 3D', () => {
  it('descend dans les enfants du modèle — un groupe ne répond pas lui-même au rayon', () => {
    const handle = fakeModelHandle();
    // Sans enfant peignable, le rayon ne touche rien : le groupe racine n'a pas de géométrie.
    expect(raycastSurface(handle, [100, 100], VIEWPORT, 0)).toBeNull();
    handle.modelObject!.add(planeAt(0, 'surface'));
    handle.mesh.updateMatrixWorld(true);
    const sample = raycastSurface(handle, [100, 100], VIEWPORT, 0);
    expect(sample).not.toBeNull();
    expect(sample!.depth).toBeCloseTo(10, 5);
  });

  it('ignore ce qui n’est pas la surface du modèle — traits déjà posés, clones de comparaison', () => {
    const handle = fakeModelHandle();
    handle.modelObject!.add(planeAt(0, 'surface'));
    // Un trait est enfant du groupe RACINE, plus près de la caméra que la surface : sans le
    // ciblage sur `modelObject`, peindre par-dessus un trait accrocherait le trait.
    handle.mesh.add(planeAt(5, 'trait'));
    handle.mesh.updateMatrixWorld(true);
    const sample = raycastSurface(handle, [100, 100], VIEWPORT, 0);
    expect(sample!.depth).toBeCloseTo(10, 5);
  });

  it('écarte les options de variante invisibles, toutes cuites au même endroit', () => {
    const handle = fakeModelHandle();
    const hidden = planeAt(5, 'variante cachée');
    hidden.visible = false;
    handle.modelObject!.add(hidden, planeAt(0, 'variante visible'));
    handle.mesh.updateMatrixWorld(true);
    const sample = raycastSurface(handle, [100, 100], VIEWPORT, 0);
    expect(sample!.depth).toBeCloseTo(10, 5);
  });
});

describe('paintHandle', () => {
  it('refuse une poignée sans objet à peindre — la scène n’est pas montée', () => {
    expect(paintHandle(null)).toBeNull();
    expect(paintHandle({ THREE } as unknown as PaintSceneHandle)).toBeNull();
    const handle = fakeModelHandle();
    expect(paintHandle(handle)).toBe(handle);
  });
});
