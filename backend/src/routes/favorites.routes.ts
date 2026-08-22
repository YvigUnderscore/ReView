// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { EntityType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
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

// Résout le projet contenant l'entité (pour le contrôle d'accès).
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

// GET /api/favorites — favoris de l'utilisateur courant (enrichis).
// L'accès au projet est revérifié à chaque lecture : un favori n'est pas un droit acquis,
// et la barre latérale ne doit pas continuer à nommer les plans d'un film qu'on a quitté.
router.get('/', async (req, res) => {
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, type: true, entityId: true },
  });
  res.json({ favorites: await resolveFavorites(req.user!.id, req.user!.role, favorites) });
});

// POST /api/favorites — ajoute un favori
router.post(
  '/',
  validate({ body: z.object({ type: z.nativeEnum(EntityType), entityId: z.number().int() }) }),
  async (req, res) => {
    const { type, entityId } = req.body as { type: EntityType; entityId: number };
    const projectId = await projectIdFor(type, entityId);
    if (!projectId) throw notFound('Entity not found');
    await assertProjectAccess(req, projectId);
    const favorite = await prisma.favorite.upsert({
      where: { userId_type_entityId: { userId: req.user!.id, type, entityId } },
      update: {},
      create: { userId: req.user!.id, type, entityId },
    });
    res.status(201).json({ favorite });
  },
);

// DELETE /api/favorites/:type/:entityId — retire un favori
router.delete(
  '/:type/:entityId',
  validate({ params: z.object({ type: z.nativeEnum(EntityType), entityId: z.coerce.number().int() }) }),
  async (req, res) => {
    const type = req.params.type as EntityType;
    const entityId = Number(req.params.entityId);
    await prisma.favorite.deleteMany({ where: { userId: req.user!.id, type, entityId } });
    res.status(204).end();
  },
);

export default router;
