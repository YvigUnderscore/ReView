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
 * Recomposition of a USD scene (Phase 45, 45.E): a sub-router mounted under /api/media.
 * Reserved to the media's managers and refused after publication (Phase 11 lock): both checks are made
 * by the service. The original USD file is never modified.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/**
 * POST /api/media/:id/usd/recompose: reconverts the media with another selection of variants and/or
 * another purpose. The values are re-filtered on the service side against the variantSets actually
 * present in the scene.
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
 * PUT /api/media/:id/usd/override: base override of the scene (46.D), staging replayed for everyone on
 * opening. Manager, unpublished media (the service decides). `null` clears the override.
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
