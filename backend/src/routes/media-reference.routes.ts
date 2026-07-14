import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as ReviewReferenceService from '../services/ReviewReferenceService';

/**
 * Image de référence d'une review 2D (Phase 24) — persistée & partagée. Gestion réservée aux
 * gestionnaires du média (re-vérifiée dans le service) ; la lecture est incluse dans getDetail.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

// PUT /api/media/:id/reference — dépose/remplace l'image (data URL image base64)
router.put(
  '/:id/reference',
  validate({ params: idParam, body: z.object({ dataUrl: z.string().min(1).max(8_400_000) }) }),
  async (req, res) => {
    res.json({
      reference: await ReviewReferenceService.set(req.user!, Number(req.params.id), req.body.dataUrl),
    });
  },
);

// PATCH /api/media/:id/reference — position/taille (fractions du cadre)
router.patch(
  '/:id/reference',
  validate({
    params: idParam,
    body: z.object({ x: z.number(), y: z.number(), width: z.number() }),
  }),
  async (req, res) => {
    res.json({
      reference: await ReviewReferenceService.updatePosition(req.user!, Number(req.params.id), req.body),
    });
  },
);

// DELETE /api/media/:id/reference — retire l'image de référence
router.delete('/:id/reference', validate({ params: idParam }), async (req, res) => {
  await ReviewReferenceService.remove(req.user!, Number(req.params.id));
  res.status(204).end();
});

export default router;
