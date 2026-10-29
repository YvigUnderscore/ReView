// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SdfVolumeData, SplatTransform } from '../../reviewTypes';
import { buildCropChecks, pointCropped } from '../editor/volumes/cropPoints';

/**
 * "Baking" of the non-destructive edits of a splat for the **cleaned export** (41.A):
 * pure logic (Three used for maths only, no WebGL), so it is testable.
 *
 * The in-memory `PackedSplats` already reflects the **deletion** (opacity 0) and the **subset
 * transforms** (Phase 28, written via `setSplat`). The two remaining edits, which live outside the
 * packed data, are applied here: the **crop volumes** (SDF, geometric carving, same semantics as
 * the "points" overlay) and the global **TRS transform** (gizmo). The import `baseFlip` (11.E) is
 * **not** baked: it is an axis convention of the viewer, not an edit, so the exported file stays
 * in the convention of the original.
 */

/** A baked splat, physical values ready for writing (SPZ/PLY). Colour in 0..1. */
export interface BakedSplat {
  center: [number, number, number];
  scales: [number, number, number];
  quaternion: [number, number, number, number];
  opacity: number;
  color: [number, number, number];
}

/** Iterator over the source splats: signature of `PackedSplats.forEachSplat`. */
export type ForEachSplat = (
  cb: (
    index: number,
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ) => void,
) => void;

export interface BakeOptions {
  /** Global TRS (gizmo) applied to the mesh: baked into each splat, or null if identity. */
  transform: SplatTransform | null;
  /** SDF crop volumes (carve/isolate): carved-out splats are removed. */
  volumes: SdfVolumeData[];
  /** Opacity threshold below which a splat is considered masked (default 0). */
  opacityEpsilon?: number;
}

function isIdentityTransform(t: SplatTransform): boolean {
  const [px, py, pz] = t.position;
  const [qx, qy, qz, qw] = t.quaternion;
  const [sx, sy, sz] = t.scale;
  return (
    px === 0 &&
    py === 0 &&
    pz === 0 &&
    qx === 0 &&
    qy === 0 &&
    qz === 0 &&
    qw === 1 &&
    sx === 1 &&
    sy === 1 &&
    sz === 1
  );
}

/**
 * Bakes the edited splats into a list ready for writing. Order of the edits mirrors the viewer:
 * the crop and the mask are evaluated in **local space** (raw packed data), then the global TRS
 * is applied. Masked or cropped splats are excluded.
 */
export function bakeSplats(
  three: typeof import('three'),
  forEach: ForEachSplat,
  opts: BakeOptions,
): BakedSplat[] {
  const checks = buildCropChecks(three, opts.volumes);
  const eps = opts.opacityEpsilon ?? 0;
  const transform = opts.transform && !isIdentityTransform(opts.transform) ? opts.transform : null;

  // Rotation and scale of the global TRS (precomputed): the position translation sets the centre.
  const rot = new three.Quaternion();
  const scl = new three.Vector3(1, 1, 1);
  const pos = new three.Vector3();
  if (transform) {
    pos.fromArray(transform.position);
    rot.fromArray(transform.quaternion);
    scl.fromArray(transform.scale);
  }
  const mat = new three.Matrix4().compose(pos, rot, scl);

  const out: BakedSplat[] = [];
  const c = new three.Vector3();
  const q = new three.Quaternion();
  forEach((_index, center, scales, quaternion, opacity, color) => {
    if (opacity <= eps) return; // masked splat (non-destructive deletion)
    if (checks.length && pointCropped(center.x, center.y, center.z, checks)) return; // crop volumes
    c.copy(center);
    q.copy(quaternion);
    let sx = scales.x;
    let sy = scales.y;
    let sz = scales.z;
    if (transform) {
      c.applyMatrix4(mat);
      q.premultiply(rot); // world orientation = global rotation × local orientation
      sx *= scl.x;
      sy *= scl.y;
      sz *= scl.z;
    }
    out.push({
      center: [c.x, c.y, c.z],
      scales: [sx, sy, sz],
      quaternion: [q.x, q.y, q.z, q.w],
      opacity,
      color: [color.r, color.g, color.b],
    });
  });
  return out;
}
