// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SdfVolumeData } from '@/v2/pages/review/reviewTypes';
import type { VolumeMode, VolumeShape } from './cropVolume';

/**
 * Mirror of the crop volumes in the "Points" overlay (Phase 28): the overlay is a separate cloud
 * (`pointCloud.ts`) that Spark's SDF `SplatEdit` does not touch, so which centres fall inside the
 * volumes is recomputed **geometrically**, with the same semantics as the gaussian rendering: a
 * "carve" volume hides its interior, an "isolate" volume hides everything outside it (several
 * isolating volumes: only their intersection remains). Pure functions.
 */

/** Precompiled crop test: inverse matrix (16, column-major) of the volume's local TRS. */
export interface CropCheck {
  shape: VolumeShape;
  mode: VolumeMode;
  inv: ArrayLike<number>;
}

/** Precompiles the tests from the serialized volume TRS (local space of the mesh). */
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

/** Is a point (local space of the mesh) carved out by the set of volumes? */
export function pointCropped(x: number, y: number, z: number, checks: readonly CropCheck[]): boolean {
  for (const c of checks) {
    const m = c.inv;
    // Point to the unit space of the volume (the inverse matrix absorbs position, rotation and scale).
    const lx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const ly = m[1] * x + m[5] * y + m[9] * z + m[13];
    const lz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const inside =
      c.shape === 'box'
        ? Math.abs(lx) <= 1 && Math.abs(ly) <= 1 && Math.abs(lz) <= 1
        : lx * lx + ly * ly + lz * lz <= 1;
    if (c.mode === 'delete' ? inside : !inside) return true;
  }
  return false;
}
