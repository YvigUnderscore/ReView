// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SdfVolumeData } from '../../../reviewTypes';
import type { VolumeMode, VolumeShape } from './cropVolume';

/**
 * Reflet des volumes de crop dans l'overlay « Points » (Phase 28) : l'overlay est un nuage
 * séparé (`pointCloud.ts`) que le `SplatEdit` SDF de Spark ne touche pas — on recalcule donc
 * **géométriquement** quels centres tombent dans les volumes, avec la même sémantique que le
 * rendu gaussien : un volume « creuser » cache l'intérieur, un volume « isoler » cache tout ce
 * qui est hors de lui (plusieurs isolats → seule l'intersection reste). Fonctions pures.
 */

/** Test de crop précompilé : matrice inverse (16, column-major) du TRS local du volume. */
export interface CropCheck {
  shape: VolumeShape;
  mode: VolumeMode;
  inv: ArrayLike<number>;
}

/** Précompile les tests depuis les TRS sérialisés des volumes (espace local du mesh). */
export function buildCropChecks(three: typeof import('three'), data: SdfVolumeData[]): CropCheck[] {
  const p = new three.Vector3();
  const q = new three.Quaternion();
  const s = new three.Vector3();
  return data.map((v) => {
    p.fromArray(v.position);
    q.fromArray(v.quaternion);
    s.fromArray(v.scale);
    const inv = new three.Matrix4().compose(p, q, s).invert();
    return { shape: v.shape, mode: v.mode, inv: [...inv.elements] };
  });
}

/** Un point (espace local du mesh) est-il escamoté par l'ensemble des volumes ? */
export function pointCropped(x: number, y: number, z: number, checks: readonly CropCheck[]): boolean {
  for (const c of checks) {
    const m = c.inv;
    // Point → espace unité du volume (la matrice inverse absorbe position/rotation/échelle).
    const lx = (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number);
    const ly = (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number);
    const lz = (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number);
    const inside =
      c.shape === 'box'
        ? Math.abs(lx) <= 1 && Math.abs(ly) <= 1 && Math.abs(lz) <= 1
        : lx * lx + ly * ly + lz * lz <= 1;
    if (c.mode === 'delete' ? inside : !inside) return true;
  }
  return false;
}
