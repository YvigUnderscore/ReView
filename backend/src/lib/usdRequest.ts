// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { USD_PURPOSES } from './blenderUsd';

/**
 * Schéma d'une **demande de conversion USD** : sélection de variantes + purpose.
 *
 * Deux portes d'entrée la posent, et elles doivent accepter exactement la même chose :
 *  - `POST /api/media/:id/usd/recompose` — rejouer la conversion autrement ;
 *  - `POST /api/v1/publish` — la donner dès la publication, pour que la **première**
 *    conversion soit déjà la bonne et qu'aucune recomposition ne soit nécessaire.
 *
 * Deux définitions divergeraient : un client se verrait refuser à la publication ce que la
 * recomposition acceptait. D'où ce fichier unique.
 */

/** Bornes de la sélection : un chemin de prim USD est long, mais pas illimité. */
const primPath = z.string().min(1).max(1024);
const variantName = z.string().min(1).max(200);

/** Garde-fou de volume : une sélection réaliste tient en quelques prims. */
export const USD_SELECTION_MAX_PRIMS = 64;

export const usdVariantsSchema = z
  .record(primPath, z.record(variantName, variantName))
  .default({})
  .refine((v) => Object.keys(v).length <= USD_SELECTION_MAX_PRIMS, {
    message: `Trop de prims dans la sélection (maximum ${USD_SELECTION_MAX_PRIMS})`,
  })
  .describe('Variante retenue par variantSet, indexée par chemin de prim USD');

export const usdRequestSchema = z.object({
  variants: usdVariantsSchema,
  purpose: z.enum(USD_PURPOSES).default('render').describe('Purpose USD converti'),
});

export type UsdRequestInput = z.infer<typeof usdRequestSchema>;
