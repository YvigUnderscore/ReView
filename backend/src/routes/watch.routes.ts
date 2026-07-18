import { Router } from 'express';
import { z } from 'zod';
import { WatchTargetType } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  resolveProjectIdForShot,
  resolveProjectIdForAsset,
  resolveProjectIdForVersion,
} from '../lib/pipeline';
import { notFound } from '../lib/errors';
import * as WatchService from '../services/WatchService';

const router = Router();
router.use(authenticate);

// GET /api/watch — tous les suivis de l'utilisateur (état des menus clic droit)
router.get('/', async (req, res) => {
  res.json({ watches: await WatchService.listForUser(req.user!.id) });
});

// PUT /api/watch — active/désactive le suivi d'un shot/asset/version (32.G)
router.put(
  '/',
  validate({
    body: z.object({
      targetType: z.nativeEnum(WatchTargetType),
      targetId: z.number().int().positive(),
      watching: z.boolean(),
    }),
  }),
  async (req, res) => {
    const { targetType, targetId, watching } = req.body as {
      targetType: WatchTargetType;
      targetId: number;
      watching: boolean;
    };
    const projectId =
      targetType === WatchTargetType.SHOT
        ? await resolveProjectIdForShot(targetId)
        : targetType === WatchTargetType.ASSET
          ? await resolveProjectIdForAsset(targetId)
          : await resolveProjectIdForVersion(targetId);
    if (!projectId) throw notFound('Cible introuvable');
    await assertProjectAccess(req, projectId);
    res.json({ watching: await WatchService.setWatch(req.user!.id, targetType, targetId, watching) });
  },
);

export default router;
