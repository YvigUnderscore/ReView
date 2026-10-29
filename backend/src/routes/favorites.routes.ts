// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { EntityType } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';
import * as FavoriteService from '../services/FavoriteService';

const router = Router();
router.use(authenticate);

// GET /api/favorites — the current user's favorites (enriched, re-filtered by project access).
router.get('/', async (req, res) => {
  res.json({ favorites: await FavoriteService.listFavorites(requireUser(req)) });
});

// POST /api/favorites — adds a favorite
router.post(
  '/',
  validate({ body: z.object({ type: z.nativeEnum(EntityType), entityId: z.number().int() }) }),
  async (req, res) => {
    const { type, entityId } = req.body as { type: EntityType; entityId: number };
    const projectId = await FavoriteService.projectIdForEntity(type, entityId);
    if (!projectId) throw notFound('Entity not found');
    await assertProjectAccess(req, projectId);
    const favorite = await FavoriteService.addFavorite(requireUser(req).id, type, entityId);
    res.status(201).json({ favorite });
  },
);

// DELETE /api/favorites/:type/:entityId — removes a favorite
router.delete(
  '/:type/:entityId',
  validate({ params: z.object({ type: z.nativeEnum(EntityType), entityId: z.coerce.number().int() }) }),
  async (req, res) => {
    const type = req.params.type as EntityType;
    await FavoriteService.removeFavorite(requireUser(req).id, type, Number(req.params.entityId));
    res.status(204).end();
  },
);

export default router;
