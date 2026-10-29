// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { Role, AssetType } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForShot } from '../lib/pipeline';
import { pipelineOverrideSchema } from '../lib/projectSettings';
import { notFound } from '../lib/errors';
import { cursorPaginationQuery, readPagination } from '../lib/pagination';
import * as ShotService from '../services/ShotService';
import * as PipelineLatestService from '../services/PipelineLatestService';
import { assertLocalCreationAllowed } from '../services/shotgrid/ShotgridGuardService';
import { softDeleteShot, restoreShot, purgeShot } from '../lib/trash';
import { mountTrashRoutes } from './trashRoutes';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

// Fields of a shot (creation). PATCH makes them optional via `.partial()`.
const shotBody = z.object({
  sequenceId: z.number().int().nullable().optional(),
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(60),
  startFrame: z.number().int().nullable().optional(),
  endFrame: z.number().int().nullable().optional(),
  order: z.number().int().optional(),
  settings: pipelineOverrideSchema.optional(),
});

/** Resolves a shot's project and access assertion (dynamic RBAC), returns the projectId. */
async function resolveShotAccess(req: Request, shotId: number): Promise<number> {
  const projectId = await resolveProjectIdForShot(shotId);
  if (!projectId) throw notFound('Shot not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

/**
 * GET /api/shots?projectId=X[&sequenceId=Y|none][&episodeId=Z|none]: "none" means outside a sequence,
 * respectively outside an episode. The episode filter goes through the sequence (a shot does not belong
 * to an episode directly); when absent, it restricts nothing.
 *
 * Paginated (10.D1) by page/pageSize **or** by cursor: the response carries `total`, `pageCount`,
 * `hasMore` and `nextCursor`, enough to load a feature film of two thousand shots without losing or
 * duplicating any.
 */
router.get(
  '/',
  validate({
    query: z
      .object({
        projectId: z.coerce.number().int(),
        sequenceId: z.union([z.coerce.number().int(), z.literal('none')]).optional(),
        episodeId: z.union([z.coerce.number().int(), z.literal('none')]).optional(),
      })
      .merge(cursorPaginationQuery),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const q = req.query as unknown as { sequenceId?: number | 'none'; episodeId?: number | 'none' };
    const p = readPagination(req.query);
    res.json(await ShotService.list(projectId, q.sequenceId, p, q.episodeId, requireUser(req).id));
  },
);

// POST /api/shots (admin and supervisor)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ body: shotBody.extend({ projectId: z.number().int() }) }),
  async (req, res) => {
    await assertProjectAccess(req, req.body.projectId);
    await assertLocalCreationAllowed(req.body.projectId, 'shot'); // 48: ShotGrid leads
    res.status(201).json({ shot: await ShotService.create(req.body) });
  },
);

// POST /api/shots/bulk — bulk creation (admin and supervisor)
router.post(
  '/bulk',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({ projectId: z.number().int(), items: z.array(shotBody).min(1).max(200) }),
  }),
  async (req, res) => {
    const { projectId, items } = req.body as { projectId: number; items: ShotService.BulkShotItem[] };
    await assertProjectAccess(req, projectId);
    await assertLocalCreationAllowed(projectId, 'shot'); // 48: ShotGrid leads
    res.status(201).json({ shots: await ShotService.createBulk(projectId, items) });
  },
);

// GET /api/shots/:id
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const shot = await ShotService.get(Number(req.params.id));
  await assertProjectAccess(req, shot.projectId);
  res.json({ shot });
});

// PATCH /api/shots/:id (admin and supervisor)
router.patch(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: idParam,
    body: shotBody.partial().extend({
      description: z.string().max(2000).nullable().optional(),
      // No `thumbnailKey` here: the key is written by `PUT /api/shots/:id/thumbnail`, which rebuilds it and
      // checks that it designates THIS shot. Received from the client, it let anyone presign any object in
      // the bucket, including someone else's attachment.
      // Shot status (C3): the column existed, but the PATCH did not accept it.
      pipelineStatusId: z.number().int().nullable().optional(),
      // Omitted from the edit (Phase 45): the shot is cut at the edit without losing anything.
      omitted: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveShotAccess(req, id);
    res.json({ shot: await ShotService.update(id, projectId, req.body, requireUser(req).id) });
  },
);

// POST /api/shots/:id/assets — attaches an existing asset, or creates one and attaches it.
router.post(
  '/:id/assets',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: idParam,
    body: z
      .object({
        assetId: z.number().int().optional(),
        name: z.string().min(1).max(160).optional(),
        type: z.nativeEnum(AssetType).optional(),
      })
      .refine(
        (b) => b.assetId !== undefined || (b.name && b.name.trim().length > 0),
        'assetId ou name requis',
      ),
  }),
  async (req, res) => {
    const shotId = Number(req.params.id);
    const projectId = await resolveShotAccess(req, shotId);
    res.status(201).json({ asset: await ShotService.attachAsset(shotId, projectId, req.body) });
  },
);

// DELETE /api/shots/:id/assets/:assetId — detaches an asset from a shot (without deleting it)
router.delete(
  '/:id/assets/:assetId',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int(), assetId: z.coerce.number().int() }) }),
  async (req, res) => {
    const shotId = Number(req.params.id);
    await resolveShotAccess(req, shotId);
    await ShotService.detachAsset(shotId, Number(req.params.assetId));
    res.status(204).end();
  },
);

// Trash: move to trash, restore, purge — shared mounting (C3).
mountTrashRoutes(router, {
  entityType: 'Shot',
  auditPrefix: 'SHOT',
  notFoundMessage: 'Shot not found',
  resolveProjectId: resolveProjectIdForShot,
  softDelete: (_userId, id) => softDeleteShot(id),
  restore: restoreShot,
  purge: (_userId, id) => purgeShot(id),
});

// GET /api/shots/:id/tree — the shot seen as a folder, like an asset (cf. shotOverview).
router.get('/:id/tree', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveProjectIdForShot(id);
  if (!projectId) throw notFound('Shot not found');
  await assertProjectAccess(req, projectId);
  res.json(await PipelineLatestService.shotOverview(id, requireUser(req).id));
});

/**
 * GET /api/shots/:id/latest: permalink of the shot, the counterpart of that of an asset (C3).
 *
 * It was missing, and the page of a shot nonetheless offered "copy the link": the button copied
 * `/assets/<id>/latest`, that is, the address of an unrelated entity, which the recipient opened
 * without suspecting anything.
 */
router.get('/:id/latest', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveShotAccess(req, id);
  const { latest } = await PipelineLatestService.shotOverview(id, requireUser(req).id);
  if (!latest) throw notFound('No published version for this shot', 'NO_PUBLISHED_VERSION');
  res.json({ latest });
});

export default router;
