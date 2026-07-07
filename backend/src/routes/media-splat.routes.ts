import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as SplatEditService from '../services/SplatEditService';

/**
 * Éditions non-destructives d'un splat (10.G) — sous-routeur monté sous /api/media.
 * Écriture réservée aux gestionnaires du média, splat non publié uniquement (vérifié par
 * le service). Le fichier splat original n'est jamais modifié.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const quat = z.tuple([finite, finite, finite, finite]);
const posScale = finite.positive().max(1000);
const scale3 = z.tuple([posScale, posScale, posScale]);

/**
 * PATCH /api/media/:id/splat-edits — enregistre (ou efface si null) les éditions JSON :
 * transformation TRS (gizmos) + volumes de crop SDF (boîte/sphère, creuser/isoler).
 */
router.patch(
  '/:id/splat-edits',
  validate({
    params: idParam,
    body: z.object({
      edits: z
        .object({
          transform: z.object({ position: vec3, quaternion: quat, scale: scale3 }).nullable(),
          volumes: z
            .array(
              z.object({
                shape: z.enum(['box', 'sphere']),
                mode: z.enum(['delete', 'isolate']),
                position: vec3,
                quaternion: quat,
                scale: scale3,
              }),
            )
            .max(32),
        })
        .nullable(),
    }),
  }),
  async (req, res) => {
    res.json(await SplatEditService.setSplatEdits(req.user!, Number(req.params.id), req.body.edits));
  },
);

/**
 * PUT /api/media/:id/splat-mask — masque de suppression par splat (bitset base64 → MinIO).
 * `count` = nombre de splats masqués (affichage/contrôle côté client).
 */
router.put(
  '/:id/splat-mask',
  validate({
    params: idParam,
    body: z.object({
      data: z.string().min(1).max(5_400_000), // bitset base64 (≈ 4 Mo binaire max)
      count: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    res.json(
      await SplatEditService.setSplatMask(req.user!, Number(req.params.id), req.body.data, req.body.count),
    );
  },
);

/** DELETE /api/media/:id/splat-mask — efface le masque de suppression. */
router.delete('/:id/splat-mask', validate({ params: idParam }), async (req, res) => {
  res.json(await SplatEditService.clearSplatMask(req.user!, Number(req.params.id)));
});

export default router;
