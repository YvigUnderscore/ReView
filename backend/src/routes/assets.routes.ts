// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, AssetType } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForAsset } from '../lib/pipeline';
import { softDeleteAsset, restoreAsset, purgeAsset } from '../lib/trash';
import { mountTrashRoutes } from './trashRoutes';
import { notFound } from '../lib/errors';
import { cursorPaginationQuery, readPagination } from '../lib/pagination';
import * as PipelineLatestService from '../services/PipelineLatestService';
import * as AssetService from '../services/AssetService';
import {
  assertDescriptionWritable,
  assertLocalCreationAllowed,
} from '../services/shotgrid/ShotgridGuardService';
import { enqueuePush } from '../services/shotgrid/ShotgridPushService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/**
 * GET /api/assets?projectId=X: paginated (10.D1), by page/pageSize or by cursor.
 * The response carries `total`, `pageCount`, `hasMore` and `nextCursor`.
 */
router.get(
  '/',
  validate({ query: z.object({ projectId: z.coerce.number().int() }).merge(cursorPaginationQuery) }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    res.json(await AssetService.list(projectId, readPagination(req.query), req.user!.id));
  },
);

// POST /api/assets (admin/supervisor)
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
    await assertLocalCreationAllowed(body.projectId, 'asset'); // 48: ShotGrid leads
    res.status(201).json({ asset: await AssetService.create(body) });
  },
);

// GET /api/assets/:id — full record (versions and tasks bounded, cf. AssetService).
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const asset = await AssetService.getDetail(Number(req.params.id));
  await assertProjectAccess(req, asset.projectId);
  res.json({ asset });
});

// PATCH /api/assets/:id (admin/supervisor)
router.patch(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      type: z.nativeEnum(AssetType).optional(),
      // C3: the type label was only written by the ShotGrid sync.
      typeLabel: z.string().max(120).nullable().optional(),
      description: z.string().max(2000).nullable().optional(),
      // Asset status: the site keeps its own list for it, distinct from that of the tasks: until now
      // the asset borrowed the vocabulary of the tasks.
      pipelineStatusId: z.number().int().nullable().optional(),
      // No `thumbnailKey` here: the key is written by `PUT /api/assets/:id/thumbnail`, which rebuilds it
      // and checks that it designates THIS asset. Received from the client, it let anyone presign any
      // object in the bucket, including someone else's attachment.
      shotIds: z.array(z.number().int()).optional(),
      sequenceIds: z.array(z.number().int()).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForAsset(id);
    if (!projectId) throw notFound('Asset not found');
    await assertProjectAccess(req, projectId);
    // Description held by ShotGrid: cf. the equivalent route for sequences.
    if (req.body.description !== undefined) await assertDescriptionWritable(projectId);
    const asset = await AssetService.update(projectId, id, req.body as AssetService.UpdateAssetInput);
    // Description round trip: cf. the equivalent route for sequences.
    if (req.body.description !== undefined) {
      await enqueuePush(projectId, { type: 'description', kind: 'asset', id, actorId: req.user!.id });
    }
    res.json({ asset });
  },
);

/**
 * GET /api/assets/:id/tree: the asset seen as a folder (Phase 45).
 *
 * Departments in pipe order → tasks → versions → media, plus the version that is authoritative.
 * Until now an asset's page only displayed the versions attached DIRECTLY to the asset: everything a
 * DCC published under a task was invisible.
 */
router.get('/:id/tree', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveProjectIdForAsset(id);
  if (!projectId) throw notFound('Asset not found');
  await assertProjectAccess(req, projectId);
  res.json(await PipelineLatestService.assetOverview(id, req.user!.id));
});

/**
 * GET /api/assets/:id/latest: the equivalent of a "master version", a stable address that always
 * designates the most advanced state of the asset. A link pasted into a production note stays correct
 * three months later, without anyone having to update it.
 */
router.get('/:id/latest', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveProjectIdForAsset(id);
  if (!projectId) throw notFound('Asset not found');
  await assertProjectAccess(req, projectId);
  const { latest } = await PipelineLatestService.assetOverview(id, req.user!.id);
  if (!latest) throw notFound('No published version for this asset', 'NO_PUBLISHED_VERSION');
  res.json({ latest });
});

// Trash: move to trash, restore, purge, shared mounting (C3).
mountTrashRoutes(router, {
  entityType: 'Asset',
  auditPrefix: 'ASSET',
  notFoundMessage: 'Asset not found',
  resolveProjectId: resolveProjectIdForAsset,
  softDelete: (_userId, id) => softDeleteAsset(id),
  restore: restoreAsset,
  purge: (_userId, id) => purgeAsset(id),
});

export default router;
