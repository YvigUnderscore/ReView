// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { cameraAnimShape, channelSchema, curveKeySchema } from './cameraAnimSchema';

/** The schema as used by the persisted presentation: at least one key, 256 at most. */
const presentationAnim = z.object(
  cameraAnimShape(channelSchema(curveKeySchema({ minTime: 0, maxTime: 3_600_000 }), { min: 1, max: 2 })),
);

const anim = (keys: unknown[], extra: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  version: 2,
  loop: true,
  channels: { px: { keys, ...extra } },
  ...over,
});

describe('cameraAnimSchema', () => {
  it('accepts a key of the original shape (unified mode only)', () => {
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 1, mode: 'auto' }])).success).toBe(true);
  });

  it('keeps the tangent sides, the break and the weights', () => {
    const key = {
      t: 500,
      v: -2,
      mode: 'free',
      modeIn: 'flat',
      modeOut: 'free',
      broken: true,
      tin: 0,
      tout: 0.5,
      wIn: 1,
      wOut: 1.25,
    };
    const parsed = presentationAnim.parse(anim([key]));
    // Without these fields in the schema, Zod would silently strip them and the curve would change shape
    // from one reload to the next.
    expect(parsed.channels.px?.keys[0]).toEqual(key);
  });

  it('keeps the extrapolation of the channel', () => {
    const parsed = presentationAnim.parse(
      anim([{ t: 0, v: 0, mode: 'auto' }], { pre: 'cycle', post: 'cycleOffset' }),
    );
    expect(parsed.channels.px?.pre).toBe('cycle');
    expect(parsed.channels.px?.post).toBe('cycleOffset');
  });

  it('refuses a profile, an extrapolation or a weight out of domain', () => {
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 0, mode: 'nope' }])).success).toBe(false);
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 0, mode: 'auto', modeOut: 'wobble' }])).success).toBe(
      false,
    );
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 0, mode: 'auto', wOut: 12 }])).success).toBe(false);
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 0, mode: 'auto' }], { post: 'spiral' })).success).toBe(
      false,
    );
  });

  it('accepts an animation with and without a base, and keeps the base whole', () => {
    // Without a base: the shape from before Phase 50 batch 13 remains servable as-is.
    const sans = presentationAnim.parse(anim([{ t: 0, v: 1, mode: 'auto' }]));
    expect(sans.base).toBeUndefined();
    // With a base: omitted from the schema, `z.object` would silently strip it and the next viewer's camera would fall back on the
    // origin of the world — unkeyed channels with no fallback.
    const base = {
      position: { x: 9, y: 3, z: 4 },
      target: { x: 1, y: 0.5, z: -2 },
      fov: 50,
      roll: 0.25,
    };
    const avec = presentationAnim.parse(anim([{ t: 0, v: 1, mode: 'auto' }], {}, { base }));
    expect(avec.base).toEqual(base);
  });

  it('refuses a truncated or out-of-domain base', () => {
    const ok = { position: { x: 0, y: 0, z: 0 }, target: { x: 1, y: 1, z: 1 } };
    expect(presentationAnim.safeParse(anim([{ t: 0, v: 1, mode: 'auto' }], {}, { base: ok })).success).toBe(
      true,
    );
    for (const base of [
      { position: { x: 0, y: 0 }, target: { x: 1, y: 1, z: 1 } },
      { target: { x: 1, y: 1, z: 1 } },
      { ...ok, fov: 400 },
      { ...ok, roll: 12 },
    ]) {
      expect(presentationAnim.safeParse(anim([{ t: 0, v: 1, mode: 'auto' }], {}, { base })).success).toBe(
        false,
      );
    }
  });

  it('holds the volume and time bounds of its caller', () => {
    const key = { t: 0, v: 0, mode: 'auto' as const };
    expect(presentationAnim.safeParse(anim([])).success).toBe(false);
    expect(presentationAnim.safeParse(anim([key, key, key])).success).toBe(false);
    expect(presentationAnim.safeParse(anim([{ ...key, t: -1 }])).success).toBe(false);
  });
});
