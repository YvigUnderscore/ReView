// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Hotspot3D } from '../reviewTypes';
import { toMarkerPoint } from '../three/objectHotspot';
import { frameCameraToSphere } from '../viewer/frameCamera';

/**
 * Retour caméra sur un point d'intérêt : cliquer son numéro dans le fil ramène la vue dessus,
 * dans les deux viewers spatiaux (le même code, appelé avec l'objet porteur du média).
 *
 * Le point est en espace OBJET : il est projeté par la matrice monde de l'objet, donc la vue
 * atterrit au même endroit pour tout spectateur, quelle que soit la transformation appliquée au
 * média — même règle que la présentation caméra.
 */

/**
 * Part de la scène que le cadrage d'un point occupe. Un point n'a pas de taille : sans cette
 * fraction, `frameCameraToSphere` n'aurait aucun rayon à respecter et la caméra viendrait se
 * coller dessus. Douze pour cent laissent voir le défaut **et** ce qui l'entoure.
 */
export const POI_FOCUS_RATIO = 0.12;

/** Rayon de cadrage d'un point, jamais nul — sinon le cadrage serait refusé. */
export function poiFocusRadius(sceneRadius: number): number {
  const radius = Number.isFinite(sceneRadius) ? Math.abs(sceneRadius) : 0;
  return Math.max(radius * POI_FOCUS_RATIO, 1e-3);
}

/** Cadre la caméra sur un point. `false` si la position est illisible (rien n'a bougé). */
export function focusObjectPoint(params: {
  three: typeof import('three');
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Objet porteur : le groupe du modèle 3D, le `SplatMesh` du nuage. */
  object: THREE.Object3D;
  point: Hotspot3D;
  /** Rayon de la scène — l'échelle du cadrage en dépend (un nuage n'est pas un boulon). */
  sceneRadius: number;
}): boolean {
  const { three, camera, controls, object, point, sceneRadius } = params;
  const marker = toMarkerPoint(three, point);
  if (!marker) return false;
  const center = marker.point.clone();
  if (marker.objectSpace) {
    object.updateMatrixWorld();
    center.applyMatrix4(object.matrixWorld);
  }
  return frameCameraToSphere(camera, controls, center, poiFocusRadius(sceneRadius));
}
