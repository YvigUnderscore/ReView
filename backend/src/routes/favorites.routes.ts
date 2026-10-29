// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { EntityType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate, requireUser } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  resolveProjectIdForSequence,
  resolveProjectIdForShot,
  resolveProjectIdForAsset,
} from '../lib/pipeline';
import { resolveFavorites } from '../lib/favoriteEntities';
import { notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

// Resolves the project containing the entity (for the access check).
async function projectIdFor(type: EntityType, entityId: number): Promise<number | null> {
  switch (type) {
    case 'PROJECT':
      return entityId;
    case 'SEQUENCE':
      return resolveProjectIdForSequence(entityId);
    case 'SHOT':
      return resolveProjectIdForShot(entityId);
    case 'ASSET':
      return resolveProjectIdForAsset(entityId);
  }
}

// GET /api/favorites — the current user's favorites (enriched).
// Project access is re-verified on each read: a favorite is not an acquired right, and the sidebar must
// not keep naming the shots of a film one has left.
router.get('/', async (req, res) => {
  const favorites = await prisma.favorite.findMany({
    where: { userId: requireUser(req).id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, entityId: true },
  });
  res.json({ favorites: await resolveFavorites(requireUser(req).id, requireUser(req).role, favorites) });
});

// POST /api/favorites — adds a favorite
router.post(
  '/',
  validate({ body: z.object({ type: z.nativeEnum(EntityType), entityId: z.number().int() }) }),
  async (req, res) => {
    const { type, entityId } = req.body as { type: EntityType; entityId: number };
    const projectId = await projectIdFor(type, entityId);
    if (!projectId) throw notFound('Entity not found');
    await assertProjectAccess(req, projectId);
    const favorite = await prisma.favorite.upsert({
      where: { userId_type_entityId: { userId: requireUser(req).id, type, entityId } },
      update: {},
      create: { userId: requireUser(req).id, type, entityId },
    });
    res.status(201).json({ favorite });
  },
);

// DELETE /api/favorites/:type/:entityId — removes a favorite
router.delete(
  '/:type/:entityId',
  validate({ params: z.object({ type: z.nativeEnum(EntityType), entityId: z.coerce.number().int() }) }),
  async (req, res) => {
    const type = req.params.type as EntityType;
    const entityId = Number(req.params.entityId);
    await prisma.favorite.deleteMany({ where: { userId: requireUser(req).id, type, entityId } });
    res.status(204).end();
  },
);

export default router;
