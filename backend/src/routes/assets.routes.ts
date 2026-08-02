// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, AssetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForAsset } from '../lib/pipeline';
import { softDeleteAsset, restoreAsset, purgeAsset } from '../lib/trash';
import { firstMediaThumbKeyForAsset, effectiveThumbnailUrl } from '../lib/thumbnails';
import { logAudit } from '../services/AuditService';
import { badRequest, notFound } from '../lib/errors';
import { paginationQuery, readPagination, pageArgs, paginate } from '../lib/pagination';

const router = Router();
router.use(authenticate);

// GET /api/assets?projectId=X — paginé (10.D1)
router.get(
  '/',
  validate({ query: z.object({ projectId: z.coerce.number().int() }).merge(paginationQuery) }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const p = readPagination(req.query);
    const where = { projectId, deletedAt: null };
    const [assets, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(p),
        include: { _count: { select: { versions: true, tasks: true } } },
      }),
      prisma.asset.count({ where }),
    ]);
    const items = await Promise.all(
      assets.map(async (a) => ({
        ...a,
        thumbnailUrl: await effectiveThumbnailUrl(a.thumbnailKey, await firstMediaThumbKeyForAsset(a.id)),
      })),
    );
    res.json(paginate(items, total, p));
  },
);

// POST /api/assets (admin/superviseur)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      projectId: z.number().int(),
      name: z.string().min(1).max(160),
      type: z.nativeEnum(AssetType).default(AssetType.OTHER),
      description: z.string().max(2000).optional(),
    }),
  }),
  async (req, res) => {
    const { projectId, name, type, description } = req.body as {
      projectId: number;
      name: string;
      type: AssetType;
      description?: string;
    };
    await assertProjectAccess(req, projectId);
    if (await prisma.asset.findUnique({ where: { projectId_name: { projectId, name } } })) {
      throw badRequest('Un asset avec ce nom existe déjà', 'NAME_TAKEN');
    }
    const asset = await prisma.asset.create({
      data: { projectId, name, type, description: description ?? null },
    });
    res.status(201).json({ asset });
  },
);

// GET /api/assets/:id
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { createdAt: 'desc' } },
      tasks: { orderBy: { order: 'asc' } },
      shots: { where: { deletedAt: null }, select: { id: true, code: true, name: true, sequenceId: true } },
      sequences: { where: { deletedAt: null }, select: { id: true, code: true, name: true } },
    },
  });
  if (!asset) throw notFound('Asset introuvable');
  await assertProjectAccess(req, asset.projectId);
  res.json({ asset });
});

// PATCH /api/assets/:id (admin/superviseur)
router.patch(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      type: z.nativeEnum(AssetType).optional(),
      description: z.string().max(2000).nullable().optional(),
      thumbnailKey: z.string().max(512).nullable().optional(),
      shotIds: z.array(z.number().int()).optional(),
      sequenceIds: z.array(z.number().int()).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForAsset(id);
    if (!projectId) throw notFound('Asset introuvable');
    await assertProjectAccess(req, projectId);
    const { shotIds, sequenceIds, ...scalar } = req.body as {
      shotIds?: number[];
      sequenceIds?: number[];
      [k: string]: unknown;
    };
    // Les shots/séquences liés doivent appartenir au même projet
    if (shotIds && shotIds.length > 0) {
      const ok = await prisma.shot.count({ where: { id: { in: shotIds }, projectId } });
      if (ok !== shotIds.length) throw badRequest('Shot invalide pour ce projet', 'BAD_SHOT');
    }
    if (sequenceIds && sequenceIds.length > 0) {
      const ok = await prisma.sequence.count({ where: { id: { in: sequenceIds }, projectId } });
      if (ok !== sequenceIds.length) throw badRequest('Séquence invalide pour ce projet', 'BAD_SEQUENCE');
    }
    const asset = await prisma.asset.update({
      where: { id },
      data: {
        ...scalar,
        ...(shotIds ? { shots: { set: shotIds.map((sid) => ({ id: sid })) } } : {}),
        ...(sequenceIds ? { sequences: { set: sequenceIds.map((sid) => ({ id: sid })) } } : {}),
      },
      include: {
        shots: { where: { deletedAt: null }, select: { id: true, code: true, name: true, sequenceId: true } },
        sequences: { where: { deletedAt: null }, select: { id: true, code: true, name: true } },
      },
    });
    res.json({ asset });
  },
);

// DELETE /api/assets/:id — corbeille (soft-delete, admin/superviseur)
router.delete(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForAsset(id);
    if (!projectId) throw notFound('Asset introuvable');
    await assertProjectAccess(req, projectId);
    await softDeleteAsset(id);
    logAudit({ userId: req.user!.id, action: 'ASSET_DELETE', entityType: 'Asset', entityId: id });
    res.status(204).end();
  },
);

// POST /api/assets/:id/restore (admin/superviseur)
router.post(
  '/:id/restore',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForAsset(id);
    if (!projectId) throw notFound('Asset introuvable');
    await assertProjectAccess(req, projectId);
    await restoreAsset(id);
    res.status(204).end();
  },
);

// DELETE /api/assets/:id/purge — suppression définitive (admin/superviseur)
router.delete(
  '/:id/purge',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForAsset(id);
    if (!projectId) throw notFound('Asset introuvable');
    await assertProjectAccess(req, projectId);
    await purgeAsset(id);
    logAudit({ userId: req.user!.id, action: 'ASSET_PURGE', entityType: 'Asset', entityId: id });
    res.status(204).end();
  },
);

export default router;
