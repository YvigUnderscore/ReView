// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bakeToKeyframes, sampleAnimV2 } from './hermite';
import {
  animBase,
  emptyAnim,
  normalizeAnim,
  poseToBase,
  seedAnimBase,
  upsertKey,
  type CameraAnimBase,
  type CameraAnimV2,
} from './model';
import type { SplatCamera } from '../../reviewTypes';

/**
 * THE ANIMATION'S POSE BASE (Phase 50, batch 13).
 *
 * A channel without a key falls back to a "base". That fallback was dynamic — the view of
 * whoever is watching — and two samplers took it from two places: the keyframe player from a
 * pose captured only along certain paths (the world origin otherwise), and the scene rig from
 * the layout mode's activation view. An animation built with the gizmo only keys the position:
 * its target therefore jumped to the origin on the first scrub, although it stayed in place
 * outside playback.
 *
 * The fix makes the base travel WITH the animation. What these cases lock down:
 *  - a new animation adopts its base and samples the same whatever the caller;
 *  - a legacy animation (keys, no base) samples EXACTLY as before.
 */

/** The view we build from: target far from the origin, that is the whole point. */
const view: SplatCamera = {
  position: { x: 9, y: 3, z: 4 },
  target: { x: 1, y: 0.5, z: -2 },
  fov: 50,
  aspect: 1.85,
};

/** The fallback a caller lends — deliberately different from `view`. */
const other: CameraAnimBase = {
  position: { x: -100, y: -100, z: -100 },
  target: { x: -7, y: -8, z: -9 },
  fov: 90,
};

const ORIGIN: CameraAnimBase = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };

/** "Gizmo" animation: only the position is keyed, the target never is. */
const gizmoAnim = (): CameraAnimV2 =>
  upsertKey(upsertKey(seedAnimBase(emptyAnim(), view), 'px', 0, 0, 'linear'), 'px', 1_000, 10, 'linear');

/** The same, as it was recorded before the base existed (legacy data). */
const legacyAnim = (): CameraAnimV2 =>
  upsertKey(upsertKey(emptyAnim(), 'px', 0, 0, 'linear'), 'px', 1_000, 10, 'linear');

describe('poseToBase / seedAnimBase', () => {
  it('keeps from the view only the sampled quantities', () => {
    const base = poseToBase(view);
    expect(base).toEqual({ position: view.position, target: view.target, fov: 50 });
    // Neither aspect nor an absent tilt: the base is not a second presentation.
    expect('aspect' in base).toBe(false);
    expect('roll' in base).toBe(false);
  });

  it('keeps the tilt when the view carries one', () => {
    expect(poseToBase({ ...view, roll: 0.25 }).roll).toBe(0.25);
  });

  it('adopts the base of a new animation', () => {
    expect(seedAnimBase(emptyAnim(), view).base).toEqual(poseToBase(view));
  });

  it('does not touch an animation that already carries keys (legacy data)', () => {
    const legacy = legacyAnim();
    // Identity: nothing is rewritten, so nothing changes on replay.
    expect(seedAnimBase(legacy, view)).toBe(legacy);
    expect(seedAnimBase(legacy, view).base).toBeUndefined();
  });

  it('does not rewrite a base already set, and sets nothing without a view', () => {
    const seeded = seedAnimBase(emptyAnim(), view);
    expect(seedAnimBase(seeded, { ...view, target: { x: 99, y: 99, z: 99 } })).toBe(seeded);
    expect(seedAnimBase(emptyAnim(), undefined).base).toBeUndefined();
  });

  it("animBase arbitrates: the animation's base, otherwise the lent fallback", () => {
    expect(animBase(gizmoAnim(), other)).toEqual(poseToBase(view));
    expect(animBase(legacyAnim(), other)).toBe(other);
  });
});

describe('sampleAnimV2 — a single base for both samplers', () => {
  it("the unkeyed channel follows the animation's base, not the caller's view", () => {
    const anim = gizmoAnim();
    // The keyframe player (whose fallback pose had never been captured) and the scene rig
    // (which starts from the activation view) now render the same pose.
    const fromPlayer = sampleAnimV2(anim, 500, ORIGIN);
    const fromRig = sampleAnimV2(anim, 500, other);
    expect(fromPlayer).toEqual(fromRig);
    expect(fromPlayer.target).toEqual(view.target);
    expect(fromPlayer.position).toEqual({ x: 5, y: view.position.y, z: view.position.z });
    expect(fromPlayer.fov).toBe(50);
  });

  it('the target no longer falls back to the world origin', () => {
    // The bug as the user described it: "if I go to 5 seconds, the camera
    // goes back to its original position".
    expect(sampleAnimV2(gizmoAnim(), 5_000, ORIGIN).target).not.toEqual(ORIGIN.target);
  });

  it('a base without focal length or tilt does not invent them', () => {
    const bare = seedAnimBase(emptyAnim(), { position: view.position, target: view.target });
    const anim = upsertKey(upsertKey(bare, 'px', 0, 0, 'linear'), 'px', 1_000, 10, 'linear');
    const pose = sampleAnimV2(anim, 500, other);
    expect(pose.fov).toBeUndefined();
    expect(pose.roll).toBeUndefined();
  });

  it("the glTF export bakes the animation's base, not the exporter's view", () => {
    const baked = bakeToKeyframes(gizmoAnim(), ORIGIN, 4);
    for (const kf of baked) expect(kf.pose.target).toEqual(view.target);
  });
});

describe('sampleAnimV2 — legacy animation unchanged', () => {
  /**
   * Hand-written values, as sampling returned them BEFORE the base existed: a keyed channel
   * interpolated (0→10 linear, so 5 at mid-course), unkeyed channels taken from the lent fallback.
   * This is the before/after comparison that the playback migration requires.
   */
  it('returns exactly the previous values: unkeyed channels = lent fallback', () => {
    const legacy = legacyAnim();
    expect(legacy.base).toBeUndefined();
    expect(sampleAnimV2(legacy, 500, other)).toEqual({
      position: { x: 5, y: other.position.y, z: other.position.z },
      target: other.target,
      fov: other.fov,
    });
    expect(sampleAnimV2(legacy, 0, ORIGIN)).toEqual({
      position: { x: 0, y: 0, z: 0 },
      target: { x: 0, y: 0, z: 0 },
    });
  });

  it("follows each caller's fallback, divergence included — behavior at the time", () => {
    const legacy = legacyAnim();
    expect(sampleAnimV2(legacy, 500, ORIGIN).target).toEqual(ORIGIN.target);
    expect(sampleAnimV2(legacy, 500, other).target).toEqual(other.target);
  });
});

describe('normalizeAnim — the base goes through playback', () => {
  it('returns the animation as is, base included and without copying', () => {
    const anim = gizmoAnim();
    const read = normalizeAnim(JSON.parse(JSON.stringify(anim)));
    expect(read?.base).toEqual(poseToBase(view));
    // Identity preserved for a healthy animation: effects depend on it.
    expect(normalizeAnim(anim)).toBe(anim);
  });

  it('drops an unreadable base instead of breaking sampling', () => {
    const forged: unknown = { ...legacyAnim(), base: { position: 'nope', target: null } };
    const read = normalizeAnim(forged);
    expect(read).not.toBeNull();
    expect(read?.base).toBeUndefined();
    // And sampling falls back to the lent fallback, without throwing.
    expect(sampleAnimV2(read as CameraAnimV2, 500, other).target).toEqual(other.target);
  });
});
