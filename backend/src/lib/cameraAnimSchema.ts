// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Validated shape of a "by channels" v2 camera animation (Phase 17; separate tangent sides, weighting and pre/post-infinity in Phase 50, batch 7).
 *
 * It used to be written **twice**: in the persisted presentation route and in the comment payload — two schemas that had to be evolved together.
 * They no longer are: both callers derive from here, with their own bounds (a presentation is bounded to 256 keys per channel, an animation
 * attached to a comment to 2,000).
 *
 * A missing field would not be a visible error: `z.object` **strips** silently what it does not know, so a new tangent profile would be saved
 * without its separate side and the curve would change shape from one reload to the next. Every new key field — and every new animation field,
 * such as the base of Phase 50 batch 13 — is declared here, as `optional()`, the day it is written on the client side.
 */

const finite = z.number().finite();

/** Animatable channels — mirror of `CHANNEL_IDS` on the front end. */
export const CHANNEL_ID_VALUES = ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'fov', 'roll'] as const;
/** Legacy unified mode of a key (original v2 shape, still written). */
export const TANGENT_MODE_VALUES = ['auto', 'linear', 'step', 'free'] as const;
/** Tangent type of one side of a key. */
export const TANGENT_TYPE_VALUES = ['auto', 'linear', 'flat', 'step', 'free'] as const;
/** Extrapolation of a channel beyond its keys. */
export const EXTRAPOLATION_VALUES = ['constant', 'cycle', 'cycleOffset', 'linear', 'oscillate'] as const;

/** Key of an F-curve. `maxValue` absent = any finite value (persisted presentation). */
export function curveKeySchema(opts: { minTime: number; maxTime: number; maxValue?: number }) {
  const value = opts.maxValue == null ? finite : finite.min(-opts.maxValue).max(opts.maxValue);
  const tangentType = z.enum(TANGENT_TYPE_VALUES);
  return z.object({
    t: finite.min(opts.minTime).max(opts.maxTime), // ms from the start
    v: value,
    tin: finite.optional(),
    tout: finite.optional(),
    mode: z.enum(TANGENT_MODE_VALUES),
    modeIn: tangentType.optional(),
    modeOut: tangentType.optional(),
    broken: z.boolean().optional(),
    // Weights: the client bounds them more tightly (0.05 to 1.5) and clamps on read.
    wIn: finite.min(0).max(3).optional(),
    wOut: finite.min(0).max(3).optional(),
  });
}

/** Channel: its sorted keys and its extrapolation on either side. */
export function channelSchema(keys: z.ZodTypeAny, bounds: { min?: number; max: number }) {
  const extrapolation = z.enum(EXTRAPOLATION_VALUES);
  return z.object({
    keys: z
      .array(keys)
      .min(bounds.min ?? 0)
      .max(bounds.max),
    pre: extrapolation.optional(),
    post: extrapolation.optional(),
  });
}

const vec3 = z.object({ x: finite, y: finite, z: finite });

/**
 * Persisted fallback pose **with** the animation (Phase 50, batch 13): channels without keys read it at sampling time, on every viewer and at export.
 * Optional — an animation saved before it carries none and keeps the client's dynamic fallback, whose replay does not change.
 * Bounds taken from the camera pose of the presentation (`media-splat.routes`): it is the same view, captured by the same viewer. It only carries the
 * sampled quantities — neither aspect nor depth of field: the base is not a second presentation.
 */
const cameraAnimBase = z.object({
  position: vec3,
  target: vec3,
  fov: finite.min(5).max(150).optional(),
  roll: finite.min(-Math.PI).max(Math.PI).optional(),
});

/** Full animation (excluding the `type` discriminant of the comment payload). */
export function cameraAnimShape<C extends z.ZodType>(channels: C) {
  return {
    version: z.literal(2),
    loop: z.boolean(),
    durationMs: z.number().int().min(0).max(3_600_000).optional(),
    channels: z.partialRecord(z.enum(CHANNEL_ID_VALUES), channels),
    base: cameraAnimBase.optional(),
  };
}
