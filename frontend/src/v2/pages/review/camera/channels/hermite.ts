// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';
import { extrapolateValue } from './extrapolate';
import {
  animBase,
  animDuration,
  animKeyTimes,
  animPlayDuration,
  type CameraAnimBase,
  type Channel,
  type CameraAnimV2,
  type CurveKey,
} from './model';
import { slopeIn, slopeOut, typeOut, weightOf } from './tangents';

/**
 * F-curve sampling (Phase 17): per-segment cubic Hermite interpolation, with tangents following
 * the profile on **each side** of every key (`tangents.ts` — smooth, linear, flat, step,
 * free). Pure/testable. The pose at a time `t` samples each channel; an absent channel falls
 * back to the value of the **base**: the one the animation carries if it has one (Phase 50,
 * batch 13), otherwise the `base` the caller lends. `model.animBase` arbitrates, and this
 * single entry point is what guarantees that the keyframe player and the scene rig — the two
 * samplers — read the same thing.
 *
 * Two extensions from Phase 50 (batch 7), both **inert by default** — a presentation recorded
 * before them replays exactly:
 * - **weighted tangents**: a segment whose end carries a weight is evaluated as a cubic Bézier
 *   solved in x. A Hermite IS the weight-1 Bézier, so the extension is exact; the weighted path
 *   is only used if a weight is written in the key.
 * - **pre/post-infinity**: outside the keys, the curve followed the extreme value; this is
 *   exactly `constant`, the fallback when the channel sets nothing.
 */

/** Scalar cubic Bézier (one axis) at parameter `u`. */
const bez = (a: number, b: number, c: number, d: number, u: number): number => {
  const s = 1 - u;
  return s * s * s * a + 3 * s * s * u * b + 3 * s * u * u * c + u * u * u * d;
};

/**
 * Segment with **weighted** tangents: a cubic Bézier whose control points sit at `w × dt/3`
 * from each key. Since x is increasing (weights bounded by `clampWeight`), the parameter is
 * found by bisection — 24 iterations, a residual on the order of a ten-millionth of a segment.
 */
function evalWeighted(k0: CurveKey, k1: CurveKey, t: number, m0: number, m1: number): number {
  const dt = k1.t - k0.t || 1;
  const d0 = (weightOf(k0, 'out') * dt) / 3;
  const d1 = (weightOf(k1, 'in') * dt) / 3;
  const x1 = k0.t + d0;
  const x2 = k1.t - d1;
  const y1 = k0.v + m0 * d0;
  const y2 = k1.v - m1 * d1;
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 24; n++) {
    const u = (lo + hi) / 2;
    if (bez(k0.t, x1, x2, k1.t, u) < t) lo = u;
    else hi = u;
  }
  return bez(k0.v, y1, y2, k1.v, (lo + hi) / 2);
}

/** Value **within** the curve's bounds (clamped at the extremes) — at least two keys. */
function evalInside(keys: readonly CurveKey[], t: number): number {
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  // Segment [i, i+1] containing t.
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  if (typeOut(k0) === 'step') return k0.v; // step: holds the value until the next key
  const dt = k1.t - k0.t || 1;
  const s0 = slopeOut(keys, i);
  const s1 = slopeIn(keys, i + 1);
  if (k0.wOut != null || k1.wIn != null) return evalWeighted(k0, k1, t, s0, s1);
  const u = (t - k0.t) / dt;
  const m0 = s0 * dt; // tangents expressed over the parameter u
  const m1 = s1 * dt;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * k0.v + h10 * m0 + h01 * k1.v + h11 * m1;
}

/** Value of a channel at time `t` (ms), or `fallback` if the channel is empty. */
export function evalChannel(channel: Channel | undefined, t: number, fallback: number): number {
  const keys = channel?.keys;
  if (!keys || keys.length === 0) return fallback;
  if (keys.length === 1) return keys[0].v;
  const inside = (time: number) => evalInside(keys, time);
  if (t < keys[0].t) return extrapolateValue(keys, channel.pre ?? 'constant', 'pre', t, inside);
  if (t > keys[keys.length - 1].t)
    return extrapolateValue(keys, channel.post ?? 'constant', 'post', t, inside);
  return inside(t);
}

/**
 * Camera pose at time `timeMs`. In loop mode the time wraps over the duration; otherwise it is
 * clamped. Absent channels take the value of the effective base — the animation's own if it
 * has one, otherwise the lent `base` (`model.animBase`). `null` if the animation is not
 * playable (fewer than 2 key times — the guard is on the caller's side; here the base is returned).
 */
export function sampleAnimV2(anim: CameraAnimV2, timeMs: number, base: CameraAnimBase): SplatCamera {
  // Effective playback duration (adjustable override or last key time) — Phase 27.
  const duration = animPlayDuration(anim);
  const t =
    duration <= 0
      ? 0
      : anim.loop
        ? ((timeMs % duration) + duration) % duration
        : Math.min(Math.max(timeMs, 0), duration);
  const ch = anim.channels;
  // Persisted base if the animation carries one, otherwise the one the caller lends (legacy fallback).
  const b = animBase(anim, base);
  const pose: SplatCamera = {
    position: {
      x: evalChannel(ch.px, t, b.position.x),
      y: evalChannel(ch.py, t, b.position.y),
      z: evalChannel(ch.pz, t, b.position.z),
    },
    target: {
      x: evalChannel(ch.tx, t, b.target.x),
      y: evalChannel(ch.ty, t, b.target.y),
      z: evalChannel(ch.tz, t, b.target.z),
    },
  };
  if (ch.fov || b.fov != null) pose.fov = evalChannel(ch.fov, t, b.fov ?? 60);
  if (ch.roll || b.roll != null) pose.roll = evalChannel(ch.roll, t, b.roll ?? 0);
  return pose;
}

/**
 * "Bakes" the v2 animation into sampled v1 keyframes (glTF export): the smoothed curves are
 * sampled at `fps` over the whole duration, plus the exact key times, to preserve the shape of
 * the F-curves in the exchange format (linear interpolation between samples). Unkeyed channels
 * follow the animation's base when it carries one: the exported file no longer depends on the
 * exporter's view.
 */
export function bakeToKeyframes(anim: CameraAnimV2, base: CameraAnimBase, fps = 24): SplatCameraKeyframe[] {
  const duration = animDuration(anim);
  const times = new Set<number>(animKeyTimes(anim));
  const step = 1000 / fps;
  for (let t = 0; t <= duration; t += step) times.add(Math.round(t));
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => ({ t, pose: sampleAnimV2(anim, t, base), easing: 'linear' as const }));
}
