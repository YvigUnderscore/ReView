// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { USD_PURPOSES } from './blenderUsd';

/**
 * Schema of the "ReView override" (Phase 46, 46.D) — server mirror of the front-end type `v2/pages/review/three/sceneOverride.ts`. Any change must touch both.
 *
 * This is not USD: it is a delta specific to ReView, applied to the scene at load time.
 * It lives in two places, with the same shape:
 *  - `metadata.usdOverride` of the media: set before publication, **frozen** afterwards, replayed for all viewers;
 *  - in the annotation of a comment (`scene-override` part): a reviewer's proposal, replayed only when that comment is selected.
 *
 * The numeric bounds prevent an aberrant value (NaN, zero scale, astronomical translation) from making the scene unusable for everyone.
 */

const MAX_TRANSLATION = 1e6;
const MAX_PRIMS = 500;

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const translation = z.tuple([
  finite.min(-MAX_TRANSLATION).max(MAX_TRANSLATION),
  finite.min(-MAX_TRANSLATION).max(MAX_TRANSLATION),
  finite.min(-MAX_TRANSLATION).max(MAX_TRANSLATION),
]);
// A zero or negative scale would make the geometry vanish or flip.
const positive = finite.min(0.0001).max(10_000);
const scale3 = z.tuple([positive, positive, positive]);

const transformSchema = z.object({ t: translation, r: vec3, s: scale3 });

/** Staging clones (C1): bounded per prim — light set-dressing, not instancing. */
const MAX_CLONES_PER_PRIM = 50;
const cloneSchema = z.object({
  id: z.string().min(1).max(64),
  transform: transformSchema,
});

const primEditSchema = z.object({
  visible: z.boolean().optional(),
  transform: transformSchema.optional(),
  variants: z.record(z.string().min(1).max(200), z.string().min(1).max(200)).optional(),
  clones: z.array(cloneSchema).max(MAX_CLONES_PER_PRIM).optional(),
});

export const sceneOverrideSchema = z.object({
  version: z.literal(1),
  purpose: z.enum(USD_PURPOSES).optional(),
  prims: z
    .record(z.string().min(1).max(1024).startsWith('/'), primEditSchema)
    .prefault({})
    .refine((p) => Object.keys(p).length <= MAX_PRIMS, {
      message: `Override trop volumineux (maximum ${MAX_PRIMS} prims)`,
    }),
});

export type SceneOverride = z.infer<typeof sceneOverrideSchema>;

/** True if the override says nothing — it is then stored as `null` rather than an empty object. */
export function isEmptySceneOverride(override: SceneOverride): boolean {
  return !override.purpose && Object.keys(override.prims).length === 0;
}
