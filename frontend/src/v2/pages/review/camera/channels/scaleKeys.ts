// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CameraAnimV2, ChannelId, KeyRef } from './model';

/**
 * Scales a batch of keys around a pivot (curve editor transform box, Phase 50 batch 7) — pure
 * and testable.
 *
 * The function **changes nothing**: it returns the list of moves, which the gesture passes to
 * `moveKeysBatch` through the existing path (drag baseline, single undo, sort maintained).
 * Nothing new in the model, so nothing new to migrate.
 */

/** Move requested from the model — same shape as the key gestures. */
export interface ScaledMove {
  channel: ChannelId;
  index: number;
  t: number;
  v: number;
}

/** Extent of a batch of keys (box bounds). */
export interface KeyBounds {
  tMin: number;
  tMax: number;
  vMin: number;
  vMax: number;
}

/** Bounds of a batch of keys in `anim`, or `null` if none exist. */
export function keyBounds(anim: CameraAnimV2, refs: readonly KeyRef[]): KeyBounds | null {
  let bounds: KeyBounds | null = null;
  for (const r of refs) {
    const k = anim.channels[r.channel]?.keys[r.index];
    if (!k) continue;
    if (!bounds) bounds = { tMin: k.t, tMax: k.t, vMin: k.v, vMax: k.v };
    else {
      bounds.tMin = Math.min(bounds.tMin, k.t);
      bounds.tMax = Math.max(bounds.tMax, k.t);
      bounds.vMin = Math.min(bounds.vMin, k.v);
      bounds.vMax = Math.max(bounds.vMax, k.v);
    }
  }
  return bounds;
}

/**
 * Moves of a scaling: each key moves away from (or toward) the pivot by the given factor, along
 * time, along value, or both. A factor of 1 leaves the axis untouched. `snapTime` lands the
 * times on a frame, like any key move.
 */
export function scaleKeyMoves(
  anim: CameraAnimV2,
  refs: readonly KeyRef[],
  o: {
    pivotT: number;
    scaleT: number;
    pivotV: number;
    scaleV: number;
    snapTime?: (t: number) => number;
  },
): ScaledMove[] {
  const moves: ScaledMove[] = [];
  for (const r of refs) {
    const k = anim.channels[r.channel]?.keys[r.index];
    if (!k) continue;
    const t = o.pivotT + (k.t - o.pivotT) * o.scaleT;
    moves.push({
      channel: r.channel,
      index: r.index,
      t: Math.max(0, o.snapTime ? o.snapTime(t) : t),
      v: o.pivotV + (k.v - o.pivotV) * o.scaleV,
    });
  }
  return moves;
}

/**
 * Scale factor of a gesture: ratio of the distances to the pivot, from the pointer's current
 * position to its start position. Under a negligible initial distance the ratio is meaningless —
 * the factor stays at 1 rather than blowing up.
 */
export function scaleFactor(from: number, to: number, pivot: number, epsilon: number): number {
  const span = from - pivot;
  if (Math.abs(span) < epsilon) return 1;
  return (to - pivot) / span;
}
