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

// Enrichit un favori avec le libellé et le lien de navigation de l'entité.
async function resolveEntity(type: EntityType, entityId: number) {
  if (type === 'PROJECT') {
    const p = await prisma.project.findUnique({
      where: { id: entityId },
      select: { id: true, name: true, deletedAt: true },
    });
    return p && !p.deletedAt ? { label: p.name, projectId: p.id, to: `/projects/${p.id}` } : null;
  }
  if (type === 'SEQUENCE') {
    const s = await prisma.sequence.findUnique({
      where: { id: entityId },
      select: { code: true, name: true, projectId: true, deletedAt: true },
    });
    // Deep-link : ouvre l'onglet Séquences du projet et déplie la séquence ciblée
    return s && !s.deletedAt
      ? {
          label: `${s.code} · ${s.name}`,
          projectId: s.projectId,
          to: `/projects/${s.projectId}?tab=sequences&seq=${entityId}`,
        }
      : null;
  }
  if (type === 'SHOT') {
    const s = await prisma.shot.findUnique({
      where: { id: entityId },
      select: { code: true, name: true, projectId: true, deletedAt: true },
    });
    // Deep-link : ouvre l'onglet Shots et déplie le shot ciblé
    return s && !s.deletedAt
      ? {
          label: `${s.code} · ${s.name}`,
          projectId: s.projectId,
          to: `/shots/${entityId}`,
        }
      : null;
  }
  const a = await prisma.asset.findUnique({
    where: { id: entityId },
    select: { name: true, projectId: true, deletedAt: true },
  });
  return a && !a.deletedAt ? { label: a.name, projectId: a.projectId, to: `/assets/${entityId}` } : null;
}

// GET /api/favorites — favoris de l'utilisateur courant (enrichis)
router.get('/', async (req, res) => {
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
  });
  const items = (
    await Promise.all(
      favorites.map(async (f) => {
        const entity = await resolveEntity(f.type, f.entityId);
        return entity ? { id: f.id, type: f.type, entityId: f.entityId, ...entity } : null;
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);
  res.json({ favorites: items });
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
