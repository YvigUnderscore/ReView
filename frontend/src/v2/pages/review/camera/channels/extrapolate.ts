// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CurveKey, Extrapolation } from './model';
import { slopeIn, slopeOut } from './tangents';

/**
 * Extrapolation of an F-curve **outside** its keys (pre/post-infinity, DCC-style) — Phase 50, batch 7.
 * Pure and testable; wired in by `hermite.ts`, set per channel (`Channel.pre` / `Channel.post`).
 *
 * **The default reproduces the original behavior exactly.** Before this batch, a curve held
 * its extreme value beyond its keys, with nothing persisted: `constant` — the fallback when
 * `pre`/`post` are absent — does exactly that. A camera presentation recorded before this
 * batch therefore replays identically, without data migration.
 */

/** The end concerned. */
export type ExtrapolationSide = 'pre' | 'post';

/** Brings an out-of-range time back into the period, as back-and-forth (`oscillate`) or as a cycle. */
function wrap(t: number, t0: number, period: number, pingPong: boolean): number {
  const q = (t - t0) / period;
  const turn = Math.floor(q);
  const frac = q - turn;
  // Back and forth: every other pass is read backwards. JS's negative modulo forces the test
  // to check the parity of the pass, not its sign.
  const forward = !pingPong || Math.abs(turn % 2) === 0;
  return t0 + (forward ? frac : 1 - frac) * period;
}

/** Number of periods crossed (negative before the first key) — the `cycleOffset` shift. */
const turns = (t: number, t0: number, period: number): number => Math.floor((t - t0) / period);

/**
 * Value of a curve at time `t` **outside** its keys. `sampleInside` samples the curve within
 * its bounds (provided by `hermite.ts`, which owns the interpolation).
 *
 * The `linear` extension follows the tangent touching the inside of the curve — the outgoing
 * side of the first key before it, the incoming side of the last key after it: this is the
 * natural continuation of the curve, defined for every tangent profile.
 */
export function extrapolateValue(
  keys: readonly CurveKey[],
  kind: Extrapolation,
  side: ExtrapolationSide,
  t: number,
  sampleInside: (time: number) => number,
): number {
  const first = keys[0];
  const last = keys[keys.length - 1];
  const edge = side === 'pre' ? first : last;
  if (kind === 'constant') return edge.v;
  if (kind === 'linear') {
    const slope = side === 'pre' ? slopeOut(keys, 0) : slopeIn(keys, keys.length - 1);
    return edge.v + slope * (t - edge.t);
  }
  const period = last.t - first.t;
  // A curve with no time span has no cycle to replay.
  if (!(period > 0)) return edge.v;
  if (kind === 'oscillate') return sampleInside(wrap(t, first.t, period, true));
  const inside = sampleInside(wrap(t, first.t, period, false));
  if (kind === 'cycle') return inside;
  return inside + turns(t, first.t, period) * (last.v - first.v);
}
