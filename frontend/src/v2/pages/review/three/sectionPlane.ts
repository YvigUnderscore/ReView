// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

export type SectionAxis = 'x' | 'y' | 'z';

/** Vecteur d'axe monde unitaire. */
function axisVector(three: typeof import('three'), axis: SectionAxis): THREE.Vector3 {
  return new three.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
}

/**
 * Construit le plan de coupe (39.D) d'un axe/position donnés. `renderer.clippingPlanes` retire les
 * fragments de distance signée négative ; on garde donc, par défaut, la moitié « avant » la position
 * le long de l'axe (`flip` inverse le côté conservé). Pur/testable.
 *
 * - non flip : normale = -axe, constante = position  → conserve `coord ≤ position`
 * - flip     : normale = +axe, constante = -position → conserve `coord ≥ position`
 */
export function makeClipPlane(
  three: typeof import('three'),
  axis: SectionAxis,
  position: number,
  flip: boolean,
): THREE.Plane {
  const normal = axisVector(three, axis).multiplyScalar(flip ? 1 : -1);
  const constant = flip ? -position : position;
  return new three.Plane(normal, constant);
}
