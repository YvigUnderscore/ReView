// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera, SplatCameraKeyframe } from '../../reviewTypes';

/**
 * "Per-channel" camera animation model (Phase 17, v2) — 3D-software style. Each animatable
 * quantity is a channel (F-curve): a list of keys `{ t, v, tangents, mode }`, individually
 * editable (move in time/value, tangents). Replaces the v1 format (`keyframes[{ t, pose,
 * easing }]`). Pure data — sampling lives in `hermite.ts`, state/editing in `useCameraAnim`,
 * rendering in `timeline/`.
 */

/** Animatable channels: position (x/y/z), target (x/y/z), focal length, tilt. */
export type ChannelId = 'px' | 'py' | 'pz' | 'tx' | 'ty' | 'tz' | 'fov' | 'roll';
export const CHANNEL_IDS: readonly ChannelId[] = ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fov', 'roll'];

/**
 * **Unified** tangent mode of a key (original v2 shape): auto-smooth, linear, step, or free
 * (handles). It is still written into every key even when both sides diverge — it is the
 * summary read by readers that predate split sides (server Zod schemas, animations attached
 * to comments already in the database). See `tangents.ts` for the invariant.
 */
export type TangentMode = 'auto' | 'linear' | 'step' | 'free';

/**
 * Tangent type of **one side** of a key (Maya-style): `auto` (smooth), `linear`, `flat` (zero
 * slope), `step` (outgoing side only) and `free` (edited handle). When absent from a key, the
 * side falls back to `mode`: animations recorded before split sides read back identically,
 * without rewriting the data.
 */
export type TangentType = 'auto' | 'linear' | 'flat' | 'step' | 'free';

/**
 * Extrapolation of a channel **outside** its keys (pre/post-infinity, Maya-style). `constant`
 * (default, and original behavior) holds the extreme key's value; `cycle` replays the curve,
 * `cycleOffset` accumulating the gap; `linear` extends the slope; `oscillate` goes back and forth.
 */
export type Extrapolation = 'constant' | 'cycle' | 'cycleOffset' | 'linear' | 'oscillate';

/** Key of a channel: time (ms), value, incoming/outgoing tangents (slope, units/ms) if `free`. */
export interface CurveKey {
  t: number;
  v: number;
  tin?: number;
  tout?: number;
  mode: TangentMode;
  /** Incoming side type (absent = `mode`). */
  modeIn?: TangentType;
  /** Outgoing side type (absent = `mode`). */
  modeOut?: TangentType;
  /** Detached handles: pulling one side no longer rotates the other (absent = unified). */
  broken?: boolean;
  /** Incoming side weight (handle length, 1 = unweighted Hermite; absent = 1). */
  wIn?: number;
  /** Outgoing side weight (absent = 1). */
  wOut?: number;
}

export interface Channel {
  keys: CurveKey[];
  /** Extrapolation before the first key (absent = `constant`). */
  pre?: Extrapolation;
  /** Extrapolation after the last key (absent = `constant`). */
  post?: Extrapolation;
}

/**
 * Fallback pose **persisted with the animation** (Phase 50, batch 13): exactly the quantities
 * that a **keyless** channel reads during sampling (`hermite.sampleAnimV2`).
 *
 * It exists because that fallback was *dynamic* — the view of whoever is watching — and two
 * samplers took it from two places: the keyframe player from a pose captured only along certain
 * paths (`setAnim`, first key set at the view), the world origin otherwise; the scene rig from
 * the layout mode's activation view. An animation built WITH THE GIZMO, which only keys the
 * position, therefore saw its target jump to the origin on the first scrub. The base now
 * travels with the animation: same unkeyed channels, same pose, during and outside playback,
 * for every viewer, and in the glTF export.
 */
export interface CameraAnimBase {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov?: number;
  roll?: number;
}

/** Camera animation v2: independent channels + loop. Duration = largest key time. */
export interface CameraAnimV2 {
  version: 2;
  loop: boolean;
  channels: Partial<Record<ChannelId, Channel>>;
  /** Adjustable playback duration (ms) — override of the largest key time (Phase 27). Guides in
   *  the graph; loop playback runs from 0 to this duration. Editing keys beyond it is allowed. */
  durationMs?: number;
  /**
   * Fallback pose of the keyless channels (Phase 50, batch 13). **Optional**: an animation
   * recorded before it carries none and keeps the dynamic fallback of the time — its replay does
   * not change by a single character (migrated on read, like `fromV1`). A new animation adopts it
   * (`seedAnimBase`) and becomes deterministic.
   */
  base?: CameraAnimBase;
}

export const emptyAnim = (loop = true): CameraAnimV2 => ({ version: 2, loop, channels: {} });

/** Splits a camera pose into per-channel values (absent channels fall back to the base pose). */
export function poseToChannelValues(pose: SplatCamera): Record<ChannelId, number | undefined> {
  return {
    px: pose.position.x,
    py: pose.position.y,
    pz: pose.position.z,
    tx: pose.target.x,
    ty: pose.target.y,
    tz: pose.target.z,
    fov: pose.fov,
    roll: pose.roll,
  };
}

/**
 * Projects a camera pose onto the minimal shape of a base: the only values that sampling reads
 * as a fallback. Aspect and depth of field are not part of it — they are not animatable, and the
 * base is not a second presentation.
 */
export function poseToBase(pose: SplatCamera): CameraAnimBase {
  const base: CameraAnimBase = {
    position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    target: { x: pose.target.x, y: pose.target.y, z: pose.target.z },
  };
  if (pose.fov != null) base.fov = pose.fov;
  if (pose.roll != null) base.roll = pose.roll;
  return base;
}

/**
 * Effective base of an animation: its own if it carries one, otherwise `fallback` (the earlier
 * dynamic fallback). **The sole arbiter in the repo** — both samplers go through
 * `sampleAnimV2`, which goes through here: they can no longer read two different bases.
 */
export function animBase(anim: CameraAnimV2, fallback: CameraAnimBase): CameraAnimBase {
  return anim.base ?? fallback;
}

/**
 * Per-channel values of the base — what `sampleAnimV2` reads when a channel has no key. Setting
 * a key on an empty channel must write THIS value: otherwise the curve starts from zero, i.e. a
 * 0° focal length or an axis stuck at the origin. The `fov`/`roll` fallback values are those of
 * sampling.
 */
export function baseChannelValues(base: CameraAnimBase): Record<ChannelId, number> {
  return {
    px: base.position.x,
    py: base.position.y,
    pz: base.position.z,
    tx: base.target.x,
    ty: base.target.y,
    tz: base.target.z,
    fov: base.fov ?? 60,
    roll: base.roll ?? 0,
  };
}

/**
 * Adopts `view` as the animation's base — **only if it is new**: no base, no key. An animation
 * that already carries keys without a base is legacy; giving it one would change its replay
 * (persisted presentations, animations attached to comments already in the database), which is
 * ruled out. Idempotent, so callable on every key write. Pure/testable.
 */
export function seedAnimBase(anim: CameraAnimV2, view: SplatCamera | undefined): CameraAnimV2 {
  if (!view || anim.base || animKeyTimes(anim).length > 0) return anim;
  return { ...anim, base: poseToBase(view) };
}

/** Sorted, deduplicated times (ms) of all keys, across all channels (dopesheet columns). */
export function animKeyTimes(anim: CameraAnimV2): number[] {
  const set = new Set<number>();
  for (const id of CHANNEL_IDS) anim.channels[id]?.keys.forEach((k) => set.add(k.t));
  return [...set].sort((a, b) => a - b);
}

/** Total duration (ms) = largest key time (0 if none). */
export function animDuration(anim: CameraAnimV2): number {
  let max = 0;
  for (const id of CHANNEL_IDS) for (const k of anim.channels[id]?.keys ?? []) if (k.t > max) max = k.t;
  return max;
}

/** Effective playback duration (ms): the `durationMs` override if > 0, otherwise the last key time. */
export function animPlayDuration(anim: CameraAnimV2): number {
  return anim.durationMs && anim.durationMs > 0 ? anim.durationMs : animDuration(anim);
}

/** Sets the adjustable playback duration (0/undefined = automatic = last key time). */
export function setAnimDuration(anim: CameraAnimV2, durationMs: number | undefined): CameraAnimV2 {
  const next = { ...anim };
  if (durationMs && durationMs > 0) next.durationMs = Math.round(durationMs);
  else delete next.durationMs;
  return next;
}

/** An animation is playable as soon as at least one channel has 2 keys at distinct times. */
export function hasAnimation(anim: CameraAnimV2): boolean {
  return animKeyTimes(anim).length >= 2;
}

const sortKeys = (keys: CurveKey[]): CurveKey[] => [...keys].sort((a, b) => a.t - b.t);

/** Light deep copy of a channel (operations are immutable) — extrapolations included. */
const cloneChannel = (ch: Channel | undefined): Channel => ({
  ...ch,
  keys: ch ? ch.keys.map((k) => ({ ...k })) : [],
});

/**
 * Applies a mutation to a cloned channel, re-sorts its keys and returns a new animation. Exported
 * for the tangent operations (`tangents.ts`): they need the channel's full key list to materialize
 * a slope, which a key-by-key mutation does not allow.
 */
export function updateChannel(anim: CameraAnimV2, id: ChannelId, mut: (ch: Channel) => void): CameraAnimV2 {
  const ch = cloneChannel(anim.channels[id]);
  mut(ch);
  ch.keys = sortKeys(ch.keys);
  const channels = { ...anim.channels };
  if (ch.keys.length) channels[id] = ch;
  else delete channels[id];
  return { ...anim, channels };
}

/** Inserts/overwrites a key in a channel at time `t` (default mode `auto`). */
export function upsertKey(
  anim: CameraAnimV2,
  id: ChannelId,
  t: number,
  v: number,
  mode: TangentMode = 'auto',
): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    const existing = ch.keys.find((k) => k.t === t);
    if (existing) {
      existing.v = v;
    } else {
      ch.keys.push({ t, v, mode });
    }
  });
}

/** Inserts/overwrites a **complete** key (mode + tangents) at time `key.t` of a channel (copy/paste 40.E). */
export function upsertFullKey(anim: CameraAnimV2, id: ChannelId, key: CurveKey): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    const idx = ch.keys.findIndex((k) => k.t === key.t);
    if (idx >= 0) ch.keys[idx] = { ...key };
    else ch.keys.push({ ...key });
  });
}

/** Full pose → one key per filled channel, at time `t` ("set a key" button). */
export function upsertPoseAt(
  anim: CameraAnimV2,
  t: number,
  pose: SplatCamera,
  mode: TangentMode = 'auto',
): CameraAnimV2 {
  let next = anim;
  const values = poseToChannelValues(pose);
  for (const id of CHANNEL_IDS) {
    const v = values[id];
    if (v != null) next = upsertKey(next, id, t, v, mode);
  }
  return next;
}

/** Moves a key (time and/or value) — the sort is maintained. */
export function moveKey(
  anim: CameraAnimV2,
  id: ChannelId,
  index: number,
  patch: { t?: number; v?: number },
): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    const k = ch.keys[index];
    if (!k) return;
    if (patch.t != null) k.t = Math.max(0, patch.t);
    if (patch.v != null) k.v = patch.v;
  });
}

export function deleteKey(anim: CameraAnimV2, id: ChannelId, index: number): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => ch.keys.splice(index, 1));
}

/** A key designated by (channel, index) — graph editor selection (Phase 27). */
export interface KeyRef {
  channel: ChannelId;
  index: number;
}

/**
 * Moves several keys (multi-selection) in **a single pass**, designated by their index **in
 * `anim`** (the baseline captured at the start of the drag), to new t/v values. Applies all the
 * per-channel changes before re-sorting — the indices stay consistent for the whole gesture.
 * Pure/testable.
 */
export function moveKeysBatch(
  anim: CameraAnimV2,
  moves: Array<{ channel: ChannelId; index: number; t: number; v: number }>,
): CameraAnimV2 {
  const byChannel = new Map<ChannelId, Map<number, { t: number; v: number }>>();
  for (const m of moves) {
    let idxMap = byChannel.get(m.channel);
    if (!idxMap) byChannel.set(m.channel, (idxMap = new Map()));
    idxMap.set(m.index, { t: Math.max(0, Math.round(m.t)), v: m.v });
  }
  const channels = { ...anim.channels };
  for (const [id, idxMap] of byChannel) {
    const ch = cloneChannel(anim.channels[id]);
    idxMap.forEach((patch, index) => {
      const k = ch.keys[index];
      if (k) {
        k.t = patch.t;
        k.v = patch.v;
      }
    });
    ch.keys = sortKeys(ch.keys);
    channels[id] = ch;
  }
  return { ...anim, channels };
}

/** Removes a batch of keys in one pass (multi-selection). Removes from the end so as not to shift indices. */
export function deleteKeys(anim: CameraAnimV2, refs: readonly KeyRef[]): CameraAnimV2 {
  const byChannel = new Map<ChannelId, number[]>();
  for (const r of refs) {
    const list = byChannel.get(r.channel) ?? [];
    list.push(r.index);
    byChannel.set(r.channel, list);
  }
  let next = anim;
  for (const [id, indices] of byChannel) {
    next = updateChannel(next, id, (ch) => {
      for (const index of [...indices].sort((a, b) => b - a)) ch.keys.splice(index, 1);
    });
  }
  return next;
}

/**
 * Sets the extrapolation of a channel outside its keys (pre/post-infinity). `constant` clears the
 * setting: the channel recovers its original shape, where nothing was persisted.
 */
export function setChannelExtrapolation(
  anim: CameraAnimV2,
  id: ChannelId,
  patch: { pre?: Extrapolation; post?: Extrapolation },
): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    for (const side of ['pre', 'post'] as const) {
      const next = patch[side];
      if (next === undefined) continue;
      if (next === 'constant') delete ch[side];
      else ch[side] = next;
    }
  });
}

/** Removes all keys at time `t` (± tolerance) on all channels (dopesheet column). */
export function deleteColumn(anim: CameraAnimV2, t: number, tol = 1): CameraAnimV2 {
  let next = anim;
  for (const id of CHANNEL_IDS) {
    const ch = next.channels[id];
    if (!ch) continue;
    const idx = ch.keys.findIndex((k) => Math.abs(k.t - t) <= tol);
    if (idx >= 0) next = deleteKey(next, id, idx);
  }
  return next;
}

/** Shifts all keys at time `t` by `deltaMs` (retiming a dopesheet column). */
export function moveColumn(anim: CameraAnimV2, t: number, deltaMs: number, tol = 1): CameraAnimV2 {
  let next = anim;
  for (const id of CHANNEL_IDS) {
    const ch = next.channels[id];
    if (!ch) continue;
    const idx = ch.keys.findIndex((k) => Math.abs(k.t - t) <= tol);
    if (idx >= 0) next = moveKey(next, id, idx, { t: ch.keys[idx].t + deltaMs });
  }
  return next;
}

/** 3D vector usable in network data: three finite coordinates. */
const isVec3 = (v: unknown): boolean => {
  const p = v as Record<string, unknown> | null;
  return !!p && typeof p === 'object' && ['x', 'y', 'z'].every((k) => Number.isFinite(p[k]));
};

// ── Conversion from the v1 format (keyframes { t, pose, easing }) ──────────────
const easingToMode = (easing: string): TangentMode => (easing === 'linear' ? 'linear' : 'auto');

/** Converts a v1 animation (poses + easing per segment) into v2 channels. */
export function fromV1(keyframes: SplatCameraKeyframe[], loop: boolean): CameraAnimV2 {
  let anim = emptyAnim(loop);
  for (const kf of keyframes) anim = upsertPoseAt(anim, kf.t, kf.pose, easingToMode(kf.easing));
  return anim;
}

/**
 * Normalizes a persisted/attached animation, possibly in v1 format, to v2 (no data-continuity
 * constraint: we migrate on read). Accepts an unknown shape (old or new network data). Returns
 * `null` if empty/unusable.
 */
export function normalizeAnim(input: unknown): CameraAnimV2 | null {
  if (!input || typeof input !== 'object') return null;
  const a = input as { version?: number; keyframes?: SplatCameraKeyframe[]; loop?: boolean };
  if (a.version === 2) {
    const v2 = input as CameraAnimV2;
    if (!hasAnimation(v2)) return null;
    // Unreadable base (tampered data): we drop it instead of letting the render loop crash on
    // `base.position.x`. The dynamic fallback resumes — i.e. the behavior from before the base.
    if (v2.base != null && !(isVec3(v2.base.position) && isVec3(v2.base.target)))
      return { ...v2, base: undefined };
    return v2;
  }
  if (Array.isArray(a.keyframes) && a.keyframes.length >= 2) return fromV1(a.keyframes, !!a.loop);
  return null;
}
