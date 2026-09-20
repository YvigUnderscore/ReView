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
 * Position et taille en fractions de l'image. Une référence se pose **à côté** du média, dans
 * les bandes que le letterbox laisse autour de lui : le bornage 0..1 la collait d'office sur
 * l'image. Sont refusés les seuls cas irrécupérables — au-delà de trois largeurs/hauteurs
 * d'image de débordement, aucun viewer ne la montre et personne ne peut la ramener, et un
 * `NaN`/`Infinity` ferait un `left: NaN%` qui ne s'affiche pas. Des positions héritées
 * excèdent ce cadre : l'affichage les recadre dans les bandes du viewer qui les lit.
 */
const referenceBody = z.object({
  dataUrl: z.string().min(1).max(8_400_000),
  commentId: z.number().int(),
  x: z.number().min(-POS_LIMIT).max(POS_LIMIT).optional(),
  y: z.number().min(-POS_LIMIT).max(POS_LIMIT).optional(),
  width: z.number().min(0.02).max(1).optional(),
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
