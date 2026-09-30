// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as ReviewReferenceService from '../services/ReviewReferenceService';

/**
 * Images de référence d'une review 2D — **liées à un commentaire** (affichées à la
 * sélection du commentaire, position figée à la création ; plus de PATCH). Ajout par
 * l'auteur du commentaire ; la lecture est incluse dans getDetail.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const refParams = z.object({ id: z.coerce.number().int(), refId: z.coerce.number().int() });

/**
 * Débordement toléré autour du média, en largeurs/hauteurs d'image — miroir de `REF_POS_LIMIT`
 * côté client (`pages/review/referenceBox.ts`).
 */
const POS_LIMIT = 3;

/**
 * Position et taille en fractions de l'image. Une référence se pose **n'importe où** sur le
 * canvas du viewer, dedans comme dehors du cadre du média : le bornage 0..1 la collait d'office
 * sur l'image, et les bandes du letterbox interdisaient encore les côtés d'un plan large. Le
 * schéma ne refuse donc que l'irrécupérable — au-delà de trois largeurs/hauteurs d'image de
 * débordement plus aucun viewer ne la montre, et un `NaN`/`Infinity` ferait un `left: NaN%` qui
 * ne s'affiche pas (`1e999` traverse JSON en `Infinity`). Des positions héritées excèdent ce
 * cadre : l'affichage rattrape celles qu'aucun viewer ne montrerait.
 */
const fraction = z.number().finite();
const referenceBody = z.object({
  dataUrl: z.string().min(1).max(8_400_000),
  commentId: z.number().int(),
  x: fraction.min(-POS_LIMIT).max(POS_LIMIT).optional(),
  y: fraction.min(-POS_LIMIT).max(POS_LIMIT).optional(),
  width: fraction.min(0.02).max(1).optional(),
});

// POST /api/media/:id/references — joint une image (data URL base64) à un commentaire
router.post('/:id/references', validate({ params: idParam, body: referenceBody }), async (req, res) => {
  const { dataUrl, commentId, ...pos } = req.body;
  res.status(201).json({
    reference: await ReviewReferenceService.add(req.user!, Number(req.params.id), dataUrl, commentId, pos),
  });
});

// DELETE /api/media/:id/references/:refId — retire une image de référence
router.delete('/:id/references/:refId', validate({ params: refParams }), async (req, res) => {
  await ReviewReferenceService.remove(req.user!, Number(req.params.id), Number(req.params.refId));
  res.status(204).end();
});

export default router;
