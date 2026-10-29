// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

export type SectionAxis = 'x' | 'y' | 'z';

/** Unit world-axis vector. */
function axisVector(three: typeof import('three'), axis: SectionAxis): THREE.Vector3 {
  return new three.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
}

/**
 * Builds the section plane (39.D) for a given axis/position. `renderer.clippingPlanes` removes the
 * fragments with a negative signed distance; by default we therefore keep the half "before" the
 * position along the axis (`flip` reverses the kept side). Pure, testable.
 *
 * - no flip: normal = -axis, constant = position  → keeps `coord ≤ position`
 * - flip:    normal = +axis, constant = -position → keeps `coord ≥ position`
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
