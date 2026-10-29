// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { USD_PURPOSES } from './blenderUsd';

/**
 * Schema of a **USD conversion request**: variant selection + purpose.
 *
 * Two entry points set it, and they must accept exactly the same thing:
 *  - `POST /api/media/:id/usd/recompose`: replay the conversion differently;
 *  - `POST /api/v1/publish`: provide it at publication, so that the **first** conversion is
 *    already the right one and no recomposition is needed.
 *
 * Two definitions would diverge: a client would be refused at publication what recomposition
 * accepted. Hence this single file.
 */

/** Selection bounds: a USD prim path is long, but not unlimited. */
const primPath = z.string().min(1).max(1024);
const variantName = z.string().min(1).max(200);

/** Volume guard: a realistic selection fits in a few prims. */
export const USD_SELECTION_MAX_PRIMS = 64;

export const usdVariantsSchema = z
  .record(primPath, z.record(variantName, variantName))
  .prefault({})
  .refine((v) => Object.keys(v).length <= USD_SELECTION_MAX_PRIMS, {
    message: `Trop de prims dans la sélection (maximum ${USD_SELECTION_MAX_PRIMS})`,
  })
  .describe('Variante retenue par variantSet, indexée par chemin de prim USD');

export const usdRequestSchema = z.object({
  variants: usdVariantsSchema,
  purpose: z.enum(USD_PURPOSES).default('render').describe('Purpose USD converti'),
});

export type UsdRequestInput = z.infer<typeof usdRequestSchema>;
