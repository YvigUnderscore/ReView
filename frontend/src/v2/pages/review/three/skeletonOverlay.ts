// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/** Vrai si le sous-arbre contient au moins un `SkinnedMesh` (rig présent → debug squelette 40.B). */
export function hasSkinnedMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) found = true;
  });
  return found;
}

/**
 * Overlay de debug du squelette (Phase 40, 40.B) : `SkeletonHelper` (lignes des os) dessiné
 * **par-dessus** le modèle (depthTest désactivé) pour rester visible à travers la géométrie. À
 * ajouter à la scène, retirer + `dispose()` au masquage. L'helper se met à jour tout seul dans la
 * boucle de rendu (il est dans le graphe de scène), donc suit l'animation du rig.
 */
export function createSkeletonOverlay(
  three: typeof import('three'),
  root: THREE.Object3D,
): THREE.SkeletonHelper {
  const helper = new three.SkeletonHelper(root);
  const mat = helper.material as THREE.LineBasicMaterial;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.transparent = true;
  helper.renderOrder = 999;
  return helper;
}
