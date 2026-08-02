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

// POST /api/media/:id/references — joint une image (data URL base64) à un commentaire
router.post(
  '/:id/references',
  validate({
    params: idParam,
    body: z.object({
      dataUrl: z.string().min(1).max(8_400_000),
      commentId: z.number().int(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
    }),
  }),
  async (req, res) => {
    const { dataUrl, commentId, ...pos } = req.body;
    res.status(201).json({
      reference: await ReviewReferenceService.add(req.user!, Number(req.params.id), dataUrl, commentId, pos),
    });
  },
);

// DELETE /api/media/:id/references/:refId — retire une image de référence
router.delete('/:id/references/:refId', validate({ params: refParams }), async (req, res) => {
  await ReviewReferenceService.remove(req.user!, Number(req.params.id), Number(req.params.refId));
  res.status(204).end();
});

export default router;
