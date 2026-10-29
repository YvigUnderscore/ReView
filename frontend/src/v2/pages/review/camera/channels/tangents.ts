// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  updateChannel,
  type CameraAnimV2,
  type ChannelId,
  type CurveKey,
  type KeyRef,
  type TangentMode,
  type TangentType,
} from './model';

/**
 * Semantics of F-curve tangents (Phase 50, batch 7): **incoming and outgoing sides split**,
 * profiles (smooth, linear, flat, step, free), broken/unified and weighted handles. Pure and
 * testable — reading lives in `hermite.ts`, state in `useCameraAnim`.
 *
 * Three rules carry the whole file.
 *
 * 1. **The formulas do not change.** `autoSlope` is the original Catmull-Rom slope, down to the
 *    character: a camera presentation is persisted per media and replayed for every viewer —
 *    changing the formula would retroactively alter staging that people have validated.
 *
 * 2. **An absent side falls back to `mode`.** Keys recorded before split sides only carry the
 *    unified mode: `typeIn`/`typeOut` read it back as is. No data is rewritten — migration
 *    happens on read, like `normalizeAnim`.
 *
 * 3. **Materialization before any divergence.** As soon as a key stops being described by a
 *    single legacy mode, we write **the slope the read already computed** into `tin`/`tout`,
 *    and `mode` takes the value `free`. A reader that ignores split sides (server Zod schema,
 *    an animation already attached to a comment) therefore gets the same curve. This is also
 *    the fix for the observed bug: pulling ONE handle switched the key to `free` without
 *    writing the other side, which read back as 0 — the curve flattened abruptly. The only
 *    known limit of the invariant: an outgoing step forces `mode: 'step'`, and the old reader
 *    then reads the incoming side as smoothed even when it is flat.
 */

/** Side of a tangent. */
export type TangentSide = 'in' | 'out';

/** Target of a profile application: one side, or both (which unifies the key). */
export type TangentTarget = TangentSide | 'both';

/** Profiles offered to the user, in selector order. */
export const TANGENT_TYPES: readonly TangentType[] = ['auto', 'linear', 'flat', 'step', 'free'];

/**
 * Weight bounds. The sum of a segment's two weights stays ≤ 3: beyond that, the control points
 * cross in x and the curve stops being a function of time.
 */
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 1.5;

/** Brings a weight back within the bounds that keep the segment readable. */
export const clampWeight = (w: number): number => Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, w));

/** Incoming side type (absent = the key's unified mode). */
export const typeIn = (k: CurveKey): TangentType => k.modeIn ?? k.mode;
/** Outgoing side type (absent = the key's unified mode). */
export const typeOut = (k: CurveKey): TangentType => k.modeOut ?? k.mode;
/** Type of a given side. */
export const typeOf = (k: CurveKey, side: TangentSide): TangentType =>
  side === 'in' ? typeIn(k) : typeOut(k);

/** Detached handles? */
export const isBroken = (k: CurveKey): boolean => k.broken === true;
/** Weighted tangents (meaningful handle length)? */
export const isWeighted = (k: CurveKey): boolean => k.wIn != null || k.wOut != null;
/** Weight of a side (1 = unweighted Hermite). */
export const weightOf = (k: CurveKey, side: TangentSide): number =>
  clampWeight((side === 'in' ? k.wIn : k.wOut) ?? 1);

/** Original smoothed slope (Catmull-Rom over the neighbours) — formula unchanged since Phase 17. */
function autoSlope(keys: readonly CurveKey[], i: number): number {
  const k = keys[i];
  const prev = keys[i - 1] ?? k;
  const next = keys[i + 1] ?? k;
  return (next.v - prev.v) / (next.t - prev.t || 1);
}

/** Outgoing slope of a key (units/ms) according to the type of its outgoing side. */
export function slopeOut(keys: readonly CurveKey[], i: number): number {
  const k = keys[i];
  switch (typeOut(k)) {
    case 'free':
      return k.tout ?? 0;
    case 'flat':
      return 0;
    case 'linear': {
      const n = keys[i + 1];
      return n ? (n.v - k.v) / (n.t - k.t || 1) : 0;
    }
    default:
      // `auto` and `step`: the step short-circuits evaluation, its slope is never read.
      return autoSlope(keys, i);
  }
}

/** Incoming slope of a key (units/ms) according to the type of its incoming side. */
export function slopeIn(keys: readonly CurveKey[], i: number): number {
  const k = keys[i];
  switch (typeIn(k)) {
    case 'free':
      return k.tin ?? 0;
    case 'flat':
      return 0;
    case 'linear': {
      const p = keys[i - 1];
      return p ? (k.v - p.v) / (k.t - p.t || 1) : 0;
    }
    default:
      return autoSlope(keys, i);
  }
}

/** Slope of a given side. */
export const slopeOf = (keys: readonly CurveKey[], i: number, side: TangentSide): number =>
  side === 'in' ? slopeIn(keys, i) : slopeOut(keys, i);

/** Unified mode that best describes a split-sides key (see rule 3 in the header). */
function legacyMode(k: CurveKey): TangentMode {
  const a = typeIn(k);
  const b = typeOut(k);
  if (b === 'step') return 'step';
  if (a === b && (a === 'auto' || a === 'linear')) return a;
  return 'free';
}

/**
 * Closes a key after editing: materializes `tin`/`tout` when the key is no longer described by a
 * simple legacy mode, then rewrites `mode`. Call after **any** side mutation.
 */
function seal(keys: CurveKey[], i: number): void {
  const k = keys[i];
  const mode = legacyMode(k);
  if (mode === 'free') {
    k.tin = slopeIn(keys, i);
    k.tout = slopeOut(keys, i);
  } else {
    delete k.tin;
    delete k.tout;
  }
  k.mode = mode;
}

/** Writes a type on a side, materializing the current slope when the type becomes `free`. */
function writeType(keys: CurveKey[], i: number, side: TangentSide, type: TangentType): void {
  const k = keys[i];
  // `free` starts from the current shape, never from zero: that is what a DCC does when it breaks
  // a smooth tangent — the handle appears where the curve was passing.
  if (side === 'in') {
    if (type === 'free') k.tin = slopeIn(keys, i);
    k.modeIn = type;
  } else {
    if (type === 'free') k.tout = slopeOut(keys, i);
    k.modeOut = type;
  }
}

/** Groups key references by channel (a single mutation pass per channel). */
function byChannel(refs: readonly KeyRef[]): Map<ChannelId, number[]> {
  const map = new Map<ChannelId, number[]>();
  for (const r of refs) {
    const list = map.get(r.channel);
    if (list) list.push(r.index);
    else map.set(r.channel, [r.index]);
  }
  return map;
}

/** Applies a mutation to each designated key, channel by channel, with the full key list. */
function editKeys(
  anim: CameraAnimV2,
  refs: readonly KeyRef[],
  mut: (keys: CurveKey[], i: number) => void,
): CameraAnimV2 {
  let next = anim;
  for (const [id, indices] of byChannel(refs)) {
    next = updateChannel(next, id, (ch) => {
      for (const i of indices) {
        if (!ch.keys[i]) continue;
        mut(ch.keys, i);
        seal(ch.keys, i);
      }
    });
  }
  return next;
}

/** All keys of a channel, as references — to apply a profile to a whole curve. */
export const channelRefs = (anim: CameraAnimV2, id: ChannelId): KeyRef[] =>
  (anim.channels[id]?.keys ?? []).map((_, index) => ({ channel: id, index }));

/**
 * Applies a tangent profile to a batch of keys (selection, whole curve, several curves).
 * `step` is always written on the outgoing side — a step holds until the next key. An application
 * on both sides **unifies** the key; on one side only, it **breaks** it if the types differ.
 */
export function setTangentType(
  anim: CameraAnimV2,
  refs: readonly KeyRef[],
  type: TangentType,
  target: TangentTarget = 'both',
): CameraAnimV2 {
  const scope: TangentTarget = type === 'step' ? 'out' : target;
  return editKeys(anim, refs, (keys, i) => {
    if (scope !== 'out') writeType(keys, i, 'in', type);
    if (scope !== 'in') writeType(keys, i, 'out', type);
    const k = keys[i];
    // The user's intent (`target`) decides the break, not the step coercion:
    // asking for "step" on both sides must not leave the key marked as broken.
    if (target === 'both') delete k.broken;
    else if (typeIn(k) !== typeOut(k)) k.broken = true;
  });
}

/**
 * Breaks or unifies the handles of a batch of keys. Unifying aligns both sides on a single type
 * (the outgoing side's, except for step) and, if it is free, on the average of the two slopes.
 */
export function setBroken(anim: CameraAnimV2, refs: readonly KeyRef[], broken: boolean): CameraAnimV2 {
  return editKeys(anim, refs, (keys, i) => {
    const k = keys[i];
    if (broken) {
      k.broken = true;
      return;
    }
    delete k.broken;
    const common = typeOut(k) === 'step' ? typeIn(k) : typeOut(k);
    if (common === 'free') {
      const mid = (slopeIn(keys, i) + slopeOut(keys, i)) / 2;
      k.tin = mid;
      k.tout = mid;
    }
    k.modeIn = common;
    k.modeOut = common;
  });
}

/**
 * Enables or disables the weighting of a batch of keys. On activation, the weights are 1: the
 * curve does not move (a Hermite is exactly the weight-1 Bézier), only the handle becomes
 * stretchable — which is what a DCC does.
 */
export function setWeighted(anim: CameraAnimV2, refs: readonly KeyRef[], weighted: boolean): CameraAnimV2 {
  return editKeys(anim, refs, (keys, i) => {
    const k = keys[i];
    if (weighted) {
      k.wIn ??= 1;
      k.wOut ??= 1;
    } else {
      delete k.wIn;
      delete k.wOut;
    }
  });
}

/**
 * Writes the slope (and the weight, if the key is weighted) of one side — dragging a handle. A
 * **unified** key rotates both sides together; a **broken** key only moves on the side pulled.
 * The kept side keeps its read slope, never zero (see rule 3).
 */
export function setTangentSlope(
  anim: CameraAnimV2,
  id: ChannelId,
  index: number,
  side: TangentSide,
  slope: number,
  weight?: number,
): CameraAnimV2 {
  return updateChannel(anim, id, (ch) => {
    const k = ch.keys[index];
    if (!k) return;
    // A step is not carried away by the twin handle: it would make more sense to
    // disappear with one click on a profile than as a side effect of a gesture on the other side.
    const sides = (['in', 'out'] as const).filter(
      (s) => s === side || (!k.broken && typeOf(k, s) !== 'step'),
    );
    for (const s of sides) {
      writeType(ch.keys, index, s, 'free');
      if (s === 'in') {
        k.tin = slope;
        if (weight != null) k.wIn = clampWeight(weight);
      } else {
        k.tout = slope;
        if (weight != null) k.wOut = clampWeight(weight);
      }
    }
    seal(ch.keys, index);
  });
}

/**
 * Time length (ms) of a side's handle when the key is **weighted**: the weight multiplies the
 * third of the neighbouring segment (Bézier form). `null` if the key is not weighted — the handle
 * then keeps its fixed screen length.
 */
export function handleSpanMs(keys: readonly CurveKey[], i: number, side: TangentSide): number | null {
  const k = keys[i];
  const w = side === 'in' ? k.wIn : k.wOut;
  if (w == null) return null;
  const nb = side === 'in' ? keys[i - 1] : keys[i + 1];
  if (!nb) return null;
  return (clampWeight(w) * Math.abs(nb.t - k.t)) / 3;
}

/** Weight matching a pulled handle length (ms), clamped. `null` if the weight is meaningless. */
export function weightFromSpan(
  keys: readonly CurveKey[],
  i: number,
  side: TangentSide,
  spanMs: number,
): number | null {
  const nb = side === 'in' ? keys[i - 1] : keys[i + 1];
  const dt = nb ? Math.abs(nb.t - keys[i].t) : 0;
  if (!(dt > 0)) return null;
  return clampWeight((3 * Math.abs(spanMs)) / dt);
}
