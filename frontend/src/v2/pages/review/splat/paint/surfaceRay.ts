// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatSceneHandle } from '../useSplat';
import type { Projector, SurfaceSample, Vec3 } from './surfaceTrace';

/**
 * Pont entre l'écran et la surface du nuage : les deux seules opérations Three de la brosse 3D.
 * Tout le reste du raisonnement (coupure d'un trait, normale, choix du trait sous la gomme) est
 * pur et vit dans `surfaceTrace`.
 */

export interface Viewport {
  width: number;
  height: number;
}

/** Coordonnées écran → coordonnées normalisées de la caméra. */
function toNdc(point: readonly [number, number], viewport: Viewport): [number, number] {
  return [
    (point[0] / Math.max(viewport.width, 1)) * 2 - 1,
    -(point[1] / Math.max(viewport.height, 1)) * 2 + 1,
  ];
}

/**
 * Raycaste un point écran sur la surface du splat. `null` : le rayon ne touche rien (ciel, trou,
 * bord du nuage) — l'appelant en déduit que le trait s'arrête là.
 */
export function raycastSurface(
  handle: SplatSceneHandle,
  point: readonly [number, number],
  viewport: Viewport,
  screenStep: number,
): SurfaceSample | null {
  const { THREE, camera, mesh } = handle;
  const raycaster = new THREE.Raycaster();
  const [nx, ny] = toNdc(point, viewport);
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hits: { distance: number; point: THREE.Vector3; object: THREE.Object3D }[] = [];
  mesh.raycast(raycaster, hits);
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.distance - b.distance);
  const world = hits[0].point.clone();
  mesh.updateMatrixWorld();
  const inverse = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const object = world.clone().applyMatrix4(inverse);
  const cameraObject = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const depth = cameraObject.distanceTo(world);
  const toCamera = cameraObject.applyMatrix4(inverse).sub(object);
  const length = toCamera.length();
  if (length > 1e-9) toCamera.divideScalar(length);
  const asVec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
  return { world: asVec(world), object: asVec(object), depth, screenStep, toCamera: asVec(toCamera) };
}

/**
 * Projecteur espace objet → pixels de la vue, figé sur la pose courante de la caméra. Renvoie
 * `null` pour un point derrière la caméra : le projeter donnerait un pixel plausible et faux.
 */
export function makeProjector(handle: SplatSceneHandle, viewport: Viewport): Projector {
  const { THREE, camera, mesh } = handle;
  mesh.updateMatrixWorld();
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
  const point = new THREE.Vector3();
  return (x, y, z) => {
    point.set(x, y, z).applyMatrix4(matrix);
    // Espace caméra : les points visibles ont un z négatif (la caméra regarde vers -z).
    if (point.z > -1e-6) return null;
    // `applyMatrix4` fait la division perspective : le point sort en coordonnées normalisées.
    point.applyMatrix4(camera.projectionMatrix);
    return [(point.x * 0.5 + 0.5) * viewport.width, (point.y * -0.5 + 0.5) * viewport.height];
  };
}
