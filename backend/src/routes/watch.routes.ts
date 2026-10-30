// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { WatchTargetType } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
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

// GET /api/watch: all of the user's watches (state of the context menus)
router.get('/', async (req, res) => {
  res.json({ watches: await WatchService.listForUser(requireUser(req).id) });
});

// PUT /api/watch: enable/disable watching a shot/asset/version (32.G)
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
    if (!projectId) throw notFound('Target not found');
    await assertProjectAccess(req, projectId);
    res.json({ watching: await WatchService.setWatch(requireUser(req).id, targetType, targetId, watching) });
  },
);

export default router;
