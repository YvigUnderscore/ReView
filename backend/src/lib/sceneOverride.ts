// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { USD_PURPOSES } from './blenderUsd';

/**
 * Schéma du « ReView override » (Phase 46, 46.D) — miroir serveur du type front
 * `v2/pages/review/three/sceneOverride.ts`. Toute évolution doit toucher les deux.
 *
 * Ce n'est pas de l'USD : c'est un delta propre à ReView, appliqué à la scène au chargement.
 * Il vit à deux endroits, avec la même forme :
 *  - `metadata.usdOverride` du média : réglé avant publication, **figé** ensuite, rejoué pour
 *    tous les spectateurs ;
 *  - dans l'annotation d'un commentaire (partie `scene-override`) : proposition d'un reviewer,
 *    rejouée uniquement quand ce commentaire est sélectionné.
 *
 * Les bornes numériques évitent qu'une valeur aberrante (NaN, échelle nulle, translation
 * astronomique) rende la scène inexploitable pour tout le monde.
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
// Une échelle nulle ou négative ferait disparaître ou retourner la géométrie.
const positive = finite.min(0.0001).max(10_000);
const scale3 = z.tuple([positive, positive, positive]);

const primEditSchema = z.object({
  visible: z.boolean().optional(),
  transform: z.object({ t: translation, r: vec3, s: scale3 }).optional(),
  variants: z.record(z.string().min(1).max(200), z.string().min(1).max(200)).optional(),
});

export const sceneOverrideSchema = z.object({
  version: z.literal(1),
  purpose: z.enum(USD_PURPOSES).optional(),
  prims: z
    .record(z.string().min(1).max(1024).startsWith('/'), primEditSchema)
    .default({})
    .refine((p) => Object.keys(p).length <= MAX_PRIMS, {
      message: `Override trop volumineux (maximum ${MAX_PRIMS} prims)`,
    }),
});

export type SceneOverride = z.infer<typeof sceneOverrideSchema>;

/** Vrai si l'override ne dit rien — on le stocke alors comme `null` plutôt qu'objet vide. */
export function isEmptySceneOverride(override: SceneOverride): boolean {
  return !override.purpose && Object.keys(override.prims).length === 0;
}
