import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { USD_PURPOSES } from '../lib/blenderUsd';
import * as UsdRecomposeService from '../services/UsdRecomposeService';

/**
 * Recomposition d'une scène USD (Phase 45, 45.E) — sous-routeur monté sous /api/media.
 * Réservée aux gestionnaires du média et refusée après publication (verrou Phase 11) :
 * les deux contrôles sont faits par le service. Le fichier USD d'origine n'est jamais modifié.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/** Bornes de la sélection : un chemin de prim USD est long, mais pas illimité. */
const primPath = z.string().min(1).max(1024);
const variantName = z.string().min(1).max(200);

/**
 * POST /api/media/:id/usd/recompose — reconvertit le média avec une autre sélection de
 * variantes et/ou un autre purpose. Les valeurs sont re-filtrées côté service contre les
 * variantSets réellement présents dans la scène.
 */
router.post(
  '/:id/usd/recompose',
  validate({
    params: idParam,
    body: z.object({
      variants: z
        .record(primPath, z.record(variantName, variantName))
        .default({})
        // Garde-fou de volume : une sélection réaliste tient en quelques prims.
        .refine((v) => Object.keys(v).length <= 64, {
          message: 'Trop de prims dans la sélection (maximum 64)',
        }),
      purpose: z.enum(USD_PURPOSES).default('render'),
    }),
  }),
  async (req, res) => {
    res.json(
      await UsdRecomposeService.recomposeUsd(
        req.user!,
        Number(req.params.id),
        req.body as UsdRecomposeService.RecomposeInput,
      ),
    );
  },
);

export default router;
