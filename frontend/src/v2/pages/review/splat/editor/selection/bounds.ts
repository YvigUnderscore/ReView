// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { visibleLocalBox } from '../../scene/visibleBounds';
import type { SplatSceneHandle } from '../../useSplat';

/**
 * Sphères englobantes pour le cadrage caméra (raccourci `F`, 10.G-V1) : sélection courante ou
 * splat entier, exprimées en **monde** (la transformation du mesh — gizmos — est appliquée).
 * Les splats masqués (opacité 0, suppression non-destructive) sont ignorés.
 */
export interface BoundsSphere {
  center: THREE.Vector3;
  radius: number;
}

/** Sphère englobante des splats sélectionnés (monde), ou null si sélection vide/dégénérée. */
export function selectionBounds(
  handle: SplatSceneHandle,
  selected: ReadonlySet<number>,
): BoundsSphere | null {
  if (selected.size === 0) return null;
  const { THREE, mesh } = handle;
  const box = new THREE.Box3();
  const world = new THREE.Vector3();
  mesh.updateWorldMatrix(true, false); // ancêtres inclus (pivot de flip, 11.E)
  mesh.forEachSplat((index, center, _scales, _quat, opacity) => {
    if (opacity <= 0 || !selected.has(index)) return;
    world.copy(center).applyMatrix4(mesh.matrixWorld);
    box.expandByPoint(world);
  });
  const sphere = sphereFromBox(THREE, box);
  // Sélection quasi ponctuelle (1 splat) : rayon plancher pour un cadrage exploitable.
  return sphere ? { ...sphere, radius: Math.max(sphere.radius, 0.05) } : null;
}

/** Sphère englobante des splats visibles du mesh (monde), ou null si indisponible (11.D). */
export function meshBounds(handle: SplatSceneHandle): BoundsSphere | null {
  const { THREE, mesh } = handle;
  const local = visibleLocalBox(THREE, mesh);
  if (!local) return null;
  mesh.updateWorldMatrix(true, false); // ancêtres inclus (pivot de flip, 11.E)
  const box = local.applyMatrix4(mesh.matrixWorld);
  return sphereFromBox(THREE, box);
}

function sphereFromBox(three: typeof THREE, box: THREE.Box3): BoundsSphere | null {
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new three.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius < 0) return null;
  return { center: sphere.center, radius: sphere.radius };
}
