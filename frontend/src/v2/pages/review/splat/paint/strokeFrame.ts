// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import type { SplatSceneHandle } from '../useSplat';
import type { Vec3 } from './surfaceTrace';

/**
 * Entretien d'un trait **par image rendue**, accroché à `onBeforeRender` : Three l'appelle pour
 * chaque objet qu'il dessine, donc rien ne tourne quand le viewer ne rend pas. C'est ce qui
 * permet de tenir deux choses sans abonné de frame — un abonné rendrait le viewer « occupé » en
 * permanence et ferait perdre le rendu à la demande (cf. `viewer/renderScheduler`).
 *
 *  1. **Résolution de la vue** donnée au matériau : sans elle, l'épaisseur en pixels est fausse
 *     (et change au redimensionnement). `LineSegments2` a bien son propre `onBeforeRender` qui
 *     s'en charge, mais il y met le viewport en pixels **physiques** : sur un écran à densité 2,
 *     une épaisseur de 3 donnait un trait d'un pixel et demi. On la remplace donc par la taille
 *     en pixels **CSS**, la même unité que l'anneau de curseur de l'overlay — ce que l'artiste
 *     règle dans la barre d'options est alors ce qu'il voit sous le pointeur.
 *  2. **Occlusion approchée par normale.** Le nuage n'écrit pas la profondeur : un trait peint
 *     sur la face arrière restait aussi net que ceux de devant. On compare la normale du trait
 *     (la direction depuis laquelle il a été peint) à la direction de la caméra du moment, et on
 *     l'estompe quand on est passé derrière. C'est une *approximation* : elle ne sait rien des
 *     surfaces intermédiaires — un trait caché par un mur du nuage reste visible tant qu'on le
 *     regarde du même côté. Une vraie occlusion demanderait une pré-passe de profondeur du
 *     nuage, qui coûte une passe de rendu par image sur des millions de splats.
 *
 * Estomper plutôt que masquer est volontaire : le trait reste repérable en tournant autour du
 * nuage, et un objet invisible ne recevrait plus `onBeforeRender` — il ne pourrait plus revenir.
 */

/** Opacité d'un trait vu depuis l'autre face. */
export const GHOST_OPACITY = 0.16;
/** Au-dessus : pleinement visible. En dessous de `FACING_OUT` : pleinement estompé. */
const FACING_IN = 0.1;
const FACING_OUT = -0.2;

/** Opacité d'un trait selon l'orientation de sa normale face à la caméra (pure). */
export function ghostOpacity(facing: number): number {
  if (facing >= FACING_IN) return 1;
  if (facing <= FACING_OUT) return GHOST_OPACITY;
  const k = (facing - FACING_OUT) / (FACING_IN - FACING_OUT);
  return GHOST_OPACITY + k * (1 - GHOST_OPACITY);
}

/**
 * Accroche l'entretien par image au trait. `normal` absente (traits d'avant l'occlusion) :
 * seule la résolution est tenue à jour, le trait reste pleinement visible.
 */
export function attachStrokeFrame(
  line: Line2,
  handle: SplatSceneHandle,
  normal: Vec3 | null,
  center: Vec3,
): void {
  const { THREE, mesh } = handle;
  const size = new THREE.Vector2();
  const cameraObject = new THREE.Vector3();
  const inverse = new THREE.Matrix4();
  const axis = normal ? new THREE.Vector3(normal[0], normal[1], normal[2]).normalize() : null;
  const origin = new THREE.Vector3(center[0], center[1], center[2]);
  // `LineSegments2` restreint la signature de `onBeforeRender` à son seul `renderer` : on passe
  // par le contrat d'`Object3D`, qui est celui que Three appelle réellement.
  const object: THREE.Object3D = line;

  object.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getSize(size);
    line.material.resolution.set(size.x, size.y);
    if (!axis) return;
    // Position de la caméra ramenée en espace objet : le trait y vit, la normale aussi.
    cameraObject
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(inverse.copy(mesh.matrixWorld).invert())
      .sub(origin);
    const length = cameraObject.length();
    if (length < 1e-9) return;
    line.material.opacity = ghostOpacity(axis.dot(cameraObject.divideScalar(length)));
  };
}
