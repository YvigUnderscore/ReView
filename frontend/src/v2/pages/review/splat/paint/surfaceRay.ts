// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { isDrawn } from '../../three/sceneOverrideApply';
import type { ViewerSceneHandle } from '../../viewer/sceneHandle';
import type { Projector, SurfaceSample, Vec3 } from './surfaceTrace';

/**
 * Pont entre l'écran et la surface peinte : les deux seules opérations Three de la brosse 3D.
 * Tout le reste du raisonnement (coupure d'un trait, normale, choix du trait sous la gomme) est
 * pur et vit dans `surfaceTrace`.
 *
 * La brosse ne connaît plus le nuage : elle ne lit que la **poignée de scène commune**
 * (`viewer/sceneHandle`), que le splat et le modèle 3D remplissent tous les deux. C'est ce qui la
 * rend disponible sur les deux types spatiaux (Phase 50, lot 13) sans dupliquer une ligne.
 */

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Poignée de scène portant un objet à peindre. `mesh` est facultatif dans le contrat commun —
 * ici il est requis : c'est lui qui donne l'**espace objet** où le trait est stocké, et donc la
 * transformation que le trait suivra.
 */
export type PaintSceneHandle = ViewerSceneHandle & { mesh: THREE.Object3D };

/** Poignée peignable, ou `null` : la scène n'est pas (encore) montée. */
export function paintHandle(handle: ViewerSceneHandle | null | undefined): PaintSceneHandle | null {
  return handle?.mesh ? (handle as PaintSceneHandle) : null;
}

/**
 * Ce que le rayon de la brosse peut toucher, et comment l'interroger.
 *
 *  - Un **nuage** porte son raycast sur l'objet lui-même (Spark interroge les splats) ; ses
 *    enfants ne sont que des accessoires — volumes de coupe, proxy de sous-ensemble, overlay
 *    « points », traits déjà posés. On ne descend donc pas : peindre sur une boîte de coupe ou
 *    sur un trait voisin n'a aucun sens.
 *  - Un **modèle** tient sa géométrie dans ses enfants : on descend, mais depuis l'objet du
 *    modèle et non depuis le groupe racine — ce dernier porte aussi les clones de la
 *    comparaison A/B et les traits, qui ne sont pas la surface qu'on juge.
 *
 * `modelObject` distingue les deux : seul le viewer 3D le remplit (cf. `viewer/sceneHandle`).
 * Absent avant le chargement du modèle, le rayon ne touche alors rien — la brosse ne peint pas,
 * ce qui est exactement ce qu'on veut d'une scène vide.
 */
function paintTarget(handle: PaintSceneHandle): { object: THREE.Object3D; recursive: boolean } {
  return handle.modelObject
    ? { object: handle.modelObject, recursive: true }
    : { object: handle.mesh, recursive: false };
}

/** Coordonnées écran → coordonnées normalisées de la caméra. */
function toNdc(point: readonly [number, number], viewport: Viewport): [number, number] {
  return [
    (point[0] / Math.max(viewport.width, 1)) * 2 - 1,
    -(point[1] / Math.max(viewport.height, 1)) * 2 + 1,
  ];
}

/**
 * Raycaste un point écran sur la surface peinte. `null` : le rayon ne touche rien (ciel, trou,
 * bord du nuage) — l'appelant en déduit que le trait s'arrête là.
 *
 * Les objets invisibles sont écartés (`isDrawn`, la même règle que la sélection de prim) : les
 * options d'une variante USD sont toutes cuites au même endroit dans le GLB, et sans ce filtre
 * le rayon accrocherait celle que personne ne voit.
 */
export function raycastSurface(
  handle: PaintSceneHandle,
  point: readonly [number, number],
  viewport: Viewport,
  screenStep: number,
): SurfaceSample | null {
  const { THREE, camera, mesh } = handle;
  const raycaster = new THREE.Raycaster();
  const [nx, ny] = toNdc(point, viewport);
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const target = paintTarget(handle);
  // `intersectObject` trie déjà par distance croissante ; il appelle le raycast de l'objet puis,
  // si on le lui demande, descend la hiérarchie.
  const hit = raycaster.intersectObject(target.object, target.recursive).find((h) => isDrawn(h.object));
  if (!hit) return null;
  const world = hit.point.clone();
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
export function makeProjector(handle: PaintSceneHandle, viewport: Viewport): Projector {
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
