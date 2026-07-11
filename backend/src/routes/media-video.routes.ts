import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as MediaVideoService from '../services/MediaVideoService';

/**
 * Retouches vidéo non-destructives (10.G-V10) — sous-routeur monté sous /api/media.
 * Trim in/out en frames : gestionnaires du média, vidéo non publiée uniquement
 * (verrou Phase 11, vérifié par le service). L'original n'est jamais modifié.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/** PATCH /api/media/:id/trim — pose (ou efface si null) le trim ; le worker produit le proxy. */
router.patch(
  '/:id/trim',
  validate({
    params: idParam,
    body: z.object({
      trim: z
        .object({
          inFrame: z.number().int().min(0),
          outFrame: z.number().int().positive(),
        })
        .refine((t) => t.outFrame > t.inFrame, 'outFrame doit être supérieur à inFrame')
        .nullable(),
    }),
  }),
  async (req, res) => {
    res.json(await MediaVideoService.setTrim(req.user!, Number(req.params.id), req.body.trim));
  },
);

export default router;
