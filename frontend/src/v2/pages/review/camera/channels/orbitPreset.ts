// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera } from '../../reviewTypes';
import { emptyAnim, upsertFullKey, upsertKey, type CameraAnimV2 } from './model';

/**
 * "Orbit" preset — one full turn around the current target, rewritten on the mechanics of the
 * **auto-rotation** (`three/turntable.ts`): the camera→target vector rotates around the world Y
 * axis, which keeps the distance to the target and the camera height exactly. The only
 * difference from the turntable, which moves the view frame by frame: here the turn is
 * **written as keys**, so it is persisted and replayed identically for everyone.
 *
 * Three defects fixed (Phase 50, batch 7):
 *  1. the `auto` tangents (Catmull-Rom over 9 points of a cosine) gave a radius varying by
 *     4.9% and a speed varying by 16% — it was not a circle. Each key now carries the **exact
 *     tangent** of the circle (`free` mode), and 8 segments suffice: radius constant to 0.1%,
 *     speed to 0.08%;
 *  2. the last key fell back on a truncated tangent, hence a 45° direction break at every
 *     loop. The tangent at `t = duration` is that of `t = 0` (the angle differs by 2π): the
 *     loop is continuous by construction;
 *  3. the five constant channels (height, target, focal length) wrote 45 keys that added
 *     nothing and cluttered the curve editor and the history. A single key per constant channel
 *     is enough — `evalChannel` returns the value of a lone key at any time. 23 keys instead of 63.
 *
 * Constant channels are **written** rather than left empty: a channel without a key falls back
 * to the base pose, which is not persisted — the orbit would not replay identically.
 */

/** Duration of a full turn (ms). Must stay divisible by `ORBIT_STEPS`: rounding the key times
 *  is enough to bring back a varying speed (measured at 0.45% for 36 steps). */
export const ORBIT_DURATION_MS = 12000;

/** Segments of the turn. 8 with exact tangents are better than 36 in `auto`. */
const ORBIT_STEPS = 8;

/** Fallback elevation when the view is vertically above the target (rad). */
const FALLBACK_ELEVATION = Math.PI / 6;

/** Below this fraction of the distance, the horizontal gap is deemed degenerate. */
const MIN_HORIZONTAL = 0.1;

/** Turn geometry derived from the starting view. */
export interface OrbitStart {
  /** Center of the turn = target of the view. */
  center: { x: number; y: number; z: number };
  /** Radius in the XZ plane (world units). */
  radius: number;
  /** Camera height above the center — kept throughout the turn. */
  height: number;
  /** Starting angle in the XZ plane (rad). */
  angle: number;
}

/**
 * Derives the turn geometry from the current view. The general case follows the turntable:
 * radius = horizontal gap, height = vertical gap, so **the distance to the target is unchanged**.
 *
 * From a vertical top-down view, the horizontal gap is nearly zero: the old `|| 1` brought the
 * radius back to 1 world unit and the orbit changed scale entirely. We now switch to a 30°
 * elevation **while keeping the distance** — it was the scale that mattered, not the angle.
 * Pure/testable.
 */
export function orbitStartFromView(from: SplatCamera): OrbitStart {
  const center = { x: from.target.x, y: from.target.y, z: from.target.z };
  const dx = from.position.x - center.x;
  const dy = from.position.y - center.y;
  const dz = from.position.z - center.z;
  // Camera exactly on its target: no distance to keep, so we take one.
  const distance = Math.hypot(dx, dy, dz) || 1;
  const horizontal = Math.hypot(dx, dz);
  const angle = horizontal > 0 ? Math.atan2(dz, dx) : 0;
  if (horizontal >= distance * MIN_HORIZONTAL) return { center, radius: horizontal, height: dy, angle };
  return {
    center,
    radius: distance * Math.cos(FALLBACK_ELEVATION),
    height: Math.sign(dy || 1) * distance * Math.sin(FALLBACK_ELEVATION),
    angle,
  };
}

/** A full turn around the target of `from`, looping. */
export function orbitPresetV2(from: SplatCamera): CameraAnimV2 {
  const { center, radius, height, angle } = orbitStartFromView(from);
  // Constant angular speed (rad/ms) — it is what gives the exact tangents, expressed
  // in units/ms as `hermite.ts` expects.
  const omega = (2 * Math.PI) / ORBIT_DURATION_MS;
  let anim = emptyAnim(true);
  for (let i = 0; i <= ORBIT_STEPS; i++) {
    const a = angle + (i / ORBIT_STEPS) * 2 * Math.PI;
    const t = Math.round((i * ORBIT_DURATION_MS) / ORBIT_STEPS);
    const dxdt = -Math.sin(a) * radius * omega;
    const dzdt = Math.cos(a) * radius * omega;
    anim = upsertFullKey(anim, 'px', {
      t,
      v: center.x + Math.cos(a) * radius,
      tin: dxdt,
      tout: dxdt,
      mode: 'free',
    });
    anim = upsertFullKey(anim, 'pz', {
      t,
      v: center.z + Math.sin(a) * radius,
      tin: dzdt,
      tout: dzdt,
      mode: 'free',
    });
  }
  // Constant channels: a single key, at the start of the turn.
  anim = upsertKey(anim, 'py', 0, center.y + height);
  anim = upsertKey(anim, 'tx', 0, center.x);
  anim = upsertKey(anim, 'ty', 0, center.y);
  anim = upsertKey(anim, 'tz', 0, center.z);
  if (from.fov != null) anim = upsertKey(anim, 'fov', 0, from.fov);
  if (from.roll != null) anim = upsertKey(anim, 'roll', 0, from.roll);
  return anim;
}
