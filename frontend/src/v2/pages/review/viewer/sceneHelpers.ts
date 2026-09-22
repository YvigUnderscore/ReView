// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Objets d'**aide** de la scène — caméra-objet, marqueur de cible, trajectoire, gizmo. Ils
 * appartiennent à la vue libre, celle où l'artiste les manipule ; ils n'ont rien à faire dans le
 * **PiP**, qui est la vue du plan, c'est-à-dire l'image qui sera livrée.
 *
 * POURQUOI ÇA COMPTE POUR LE RETOUR VISUEL. Ces objets sont **rigides par rapport à la caméra du
 * plan** : le PiP regarde depuis la position de la caméra-objet vers son marqueur de cible, donc
 * le frustum filaire part de devant l'objectif vers les quatre coins du cadre et le marqueur se
 * tient pile au centre — quoi que fasse le plan. Dessinés dans le PiP, ils y forment une image qui
 * ne bouge **jamais** : le PiP paraissait figé alors que la caméra se déplaçait bel et bien.
 *
 * Registre de module plutôt qu'une chaîne de props : la passe PiP du splat est écrite dans la
 * boucle de `useSplat`, celle du 3D dans `useModelLayout` — deux appelants qui n'ont pas accès au
 * rig caméra, lui-même monté par la page de review. Les objets sont masqués puis restaurés dans le
 * **même** tour de boucle, sans rendu intercalé : deux viewers montés en même temps (comparaison
 * A/B) ne peuvent donc pas se gêner.
 */

const helpers = new Set<THREE.Object3D>();

/** Déclare des objets d'aide ; la fonction rendue les retire (démontage du rig). */
export function registerSceneHelpers(...objects: readonly THREE.Object3D[]): () => void {
  for (const object of objects) helpers.add(object);
  return () => {
    for (const object of objects) helpers.delete(object);
  };
}

/**
 * Joue `draw` avec les objets d'aide masqués, puis restaure exactement ceux qui étaient visibles —
 * un objet déjà caché pour une autre raison (`setVisible(false)`) le reste.
 */
export function renderWithoutHelpers(draw: () => void): void {
  const hidden: THREE.Object3D[] = [];
  for (const object of helpers) {
    if (!object.visible) continue;
    object.visible = false;
    hidden.push(object);
  }
  try {
    draw();
  } finally {
    for (const object of hidden) object.visible = true;
  }
}

/** Nombre d'objets d'aide déclarés — sert aux tests (le registre est volontairement privé). */
export function sceneHelperCount(): number {
  return helpers.size;
}
