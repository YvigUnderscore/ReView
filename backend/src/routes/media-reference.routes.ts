import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as ReviewReferenceService from '../services/ReviewReferenceService';

/**
 * Images de référence d'une review 2D (Phase 24, multi-items) — persistées & partagées,
 * épinglées au canvas. Gestion réservée aux gestionnaires du média (re-vérifiée dans le
 * service) ; la lecture est incluse dans getDetail.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const refParams = z.object({ id: z.coerce.number().int(), refId: z.coerce.number().int() });

// POST /api/media/:id/references — ajoute une image (data URL base64) au canvas
router.post(
  '/:id/references',
  validate({
    params: idParam,
    body: z.object({
      dataUrl: z.string().min(1).max(8_400_000),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
    }),
  }),
  async (req, res) => {
    const { dataUrl, ...pos } = req.body;
    res
      .status(201)
      .json({ reference: await ReviewReferenceService.add(req.user!, Number(req.params.id), dataUrl, pos) });
  },
);

// PATCH /api/media/:id/references/:refId — position/taille (fractions de l'image de base)
router.patch(
  '/:id/references/:refId',
  validate({
    params: refParams,
    body: z.object({ x: z.number(), y: z.number(), width: z.number() }),
  }),
  async (req, res) => {
    res.json({
      reference: await ReviewReferenceService.updatePosition(
        req.user!,
        Number(req.params.id),
        Number(req.params.refId),
        req.body,
      ),
    });
  },
);

// DELETE /api/media/:id/references/:refId — retire une image de référence
router.delete('/:id/references/:refId', validate({ params: refParams }), async (req, res) => {
  await ReviewReferenceService.remove(req.user!, Number(req.params.id), Number(req.params.refId));
  res.status(204).end();
});

export default router;
