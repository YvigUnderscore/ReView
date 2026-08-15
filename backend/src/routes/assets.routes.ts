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
import { notFound } from '../lib/errors';
import { paginationQuery, readPagination, pageArgs, paginate } from '../lib/pagination';
import * as PipelineLatestService from '../services/PipelineLatestService';
import * as AssetService from '../services/AssetService';
import { assertLocalCreationAllowed } from '../services/shotgrid/ShotgridGuardService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

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
    const body = req.body as AssetService.CreateAssetInput;
    await assertProjectAccess(req, body.projectId);
    await assertLocalCreationAllowed(body.projectId, 'asset'); // 48 : ShotGrid mène
    res.status(201).json({ asset: await AssetService.create(body) });
  },
);

// GET /api/assets/:id
router.get('/:id', validate({ params: idParam }), async (req, res) => {
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
    params: idParam,
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
    const asset = await AssetService.update(projectId, id, req.body as AssetService.UpdateAssetInput);
    res.json({ asset });
  },
);

/**
 * GET /api/assets/:id/tree — l'asset vu comme un dossier (Phase 45).
 *
 * Départements dans l'ordre du pipe → tâches → versions → médias, plus la version qui
 * fait foi. Jusqu'ici la page d'un asset n'affichait que les versions rattachées
 * DIRECTEMENT à l'asset : tout ce qu'un DCC publie sous une tâche était invisible.
 */
router.get('/:id/tree', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveProjectIdForAsset(id);
  if (!projectId) throw notFound('Asset introuvable');
  await assertProjectAccess(req, projectId);
  res.json(await PipelineLatestService.assetOverview(id, req.user!.id));
});

/**
 * GET /api/assets/:id/latest — l'équivalent d'une « master version » : une adresse stable
 * qui désigne toujours l'état le plus avancé de l'asset. Un lien collé dans une note de
 * production reste juste trois mois plus tard, sans que personne le remette à jour.
 */
router.get('/:id/latest', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveProjectIdForAsset(id);
  if (!projectId) throw notFound('Asset introuvable');
  await assertProjectAccess(req, projectId);
  const { latest } = await PipelineLatestService.assetOverview(id, req.user!.id);
  if (!latest) throw notFound('Aucune version publiée pour cet asset', 'NO_PUBLISHED_VERSION');
  res.json({ latest });
});

// DELETE /api/assets/:id — corbeille (soft-delete, admin/superviseur)
router.delete(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: idParam }),
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
  validate({ params: idParam }),
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
  validate({ params: idParam }),
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
