// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { usdRequestSchema } from '../lib/usdRequest';
import { sceneOverrideSchema, type SceneOverride } from '../lib/sceneOverride';
import * as UsdRecomposeService from '../services/UsdRecomposeService';
import * as UsdOverrideService from '../services/UsdOverrideService';

/**
 * Recomposition d'une scène USD (Phase 45, 45.E) — sous-routeur monté sous /api/media.
 * Réservée aux gestionnaires du média et refusée après publication (verrou Phase 11) :
 * les deux contrôles sont faits par le service. Le fichier USD d'origine n'est jamais modifié.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/**
 * POST /api/media/:id/usd/recompose — reconvertit le média avec une autre sélection de
 * variantes et/ou un autre purpose. Les valeurs sont re-filtrées côté service contre les
 * variantSets réellement présents dans la scène.
 */
router.post('/:id/usd/recompose', validate({ params: idParam, body: usdRequestSchema }), async (req, res) => {
  res.json(
    await UsdRecomposeService.recomposeUsd(
      req.user!,
      Number(req.params.id),
      req.body as UsdRecomposeService.RecomposeInput,
    ),
  );
});

/**
 * PUT /api/media/:id/usd/override — override de base de la scène (46.D) : mise en scène
 * rejouée pour tous à l'ouverture. Gestionnaire, média non publié (le service tranche).
 * `null` efface l'override.
 */
router.put(
  '/:id/usd/override',
  validate({
    params: idParam,
    body: z.object({ override: sceneOverrideSchema.nullable() }),
  }),
  async (req, res) => {
    res.json(
      await UsdOverrideService.setSceneOverride(
        req.user!,
        Number(req.params.id),
        (req.body as { override: SceneOverride | null }).override,
      ),
    );
  },
);

export default router;
