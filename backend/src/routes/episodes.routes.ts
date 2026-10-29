// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';
import { resolveProjectIdForEpisode } from '../lib/pipeline';
import { assertProjectWritable } from '../lib/projectGuard';
import { readPagination, paginationQuery } from '../lib/pagination';
import { softDeleteEpisode, restoreEpisode, purgeEpisode } from '../lib/trash';
import { logAudit } from '../services/AuditService';
import { mountTrashRoutes } from './trashRoutes';
import * as EpisodeService from '../services/EpisodeService';
import * as PipelineStatusService from '../services/PipelineStatusService';
import { assertEpisodeCreationAllowed } from '../services/shotgrid/ShotgridEpisodes';

/**
 * The Episode level (series): routes.
 *
 * Two families: the project's switch (`/settings`), readable and editable even when the level is off,
 * and the episodes themselves, which answer 409 for as long as it is off. The service carries the rule;
 * the route only validates and authorizes.
 *
 * `/settings` is declared BEFORE `/:id`: Express 5 tries routes in order, and `/:id` would capture
 * "settings" before refusing it at validation.
 */
const router = Router();
router.use(authenticate);

const manage = requireRole(Role.ADMIN, Role.SUPERVISOR);
const idParam = z.object({ id: z.coerce.number().int() });
const projectQuery = z.object({ projectId: z.coerce.number().int() });
const episodeBody = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(60),
  order: z.number().int().optional(),
});

/** Project owning the episode, access verified. Throws 404 if the episode does not exist. */
async function projectOf(req: Parameters<typeof assertProjectAccess>[0], id: number): Promise<number> {
  const projectId = await resolveProjectIdForEpisode(id);
  if (!projectId) throw notFound('Episode not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

// ── The switch ────────────────────────────────────────────────────────────
// GET stays open to any member: it is what tells the screens whether they must show the level, and an
// artist must see the same hierarchy as their supervisor.
router.get('/settings', validate({ query: projectQuery }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  res.json({ settings: await EpisodeService.readSettings(projectId) });
});

// Disabling destroys nothing (cf. EpisodeService): the episodes and their attachments survive and
// reappear intact on reactivation.
router.put(
  '/settings',
  manage,
  validate({ body: z.object({ projectId: z.number().int(), enabled: z.boolean() }) }),
  async (req, res) => {
    const { projectId, enabled } = req.body as { projectId: number; enabled: boolean };
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId);
    const settings = await EpisodeService.setEnabled(projectId, enabled);
    logAudit({
      userId: req.user!.id,
      action: enabled ? 'EPISODES_ENABLE' : 'EPISODES_DISABLE',
      entityType: 'Project',
      entityId: projectId,
    });
    res.json({ settings });
  },
);

// ── The episodes ──────────────────────────────────────────────────────────────
router.get('/', validate({ query: projectQuery.merge(paginationQuery) }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  await EpisodeService.assertEnabled(projectId);
  res.json(await EpisodeService.list(projectId, readPagination(req.query)));
});

router.post(
  '/',
  manage,
  validate({ body: episodeBody.extend({ projectId: z.number().int() }) }),
  async (req, res) => {
    const { projectId, ...input } = req.body as EpisodeService.EpisodeInput & { projectId: number };
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId);
    await assertEpisodeCreationAllowed(projectId); // ShotGrid leads: we do not create orphans
    res.status(201).json({ episode: await EpisodeService.create(projectId, input) });
  },
);

router.post(
  '/bulk',
  manage,
  validate({
    body: z.object({ projectId: z.number().int(), items: z.array(episodeBody).min(1).max(200) }),
  }),
  async (req, res) => {
    const { projectId, items } = req.body as { projectId: number; items: EpisodeService.EpisodeInput[] };
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId);
    await assertEpisodeCreationAllowed(projectId);
    res.status(201).json({ episodes: await EpisodeService.createBulk(projectId, items) });
  },
);

const reorderBody = z.object({
  projectId: z.number().int(),
  ids: z.array(z.number().int()).min(1).max(500),
});
router.post('/reorder', manage, validate({ body: reorderBody }), async (req, res) => {
  const { projectId, ids } = req.body as z.infer<typeof reorderBody>;
  await assertProjectAccess(req, projectId);
  await assertProjectWritable(projectId);
  await EpisodeService.reorder(projectId, ids);
  res.status(204).end();
});

/** Attaches sequences to an episode: `episodeId: null` detaches them. */
const assignBody = z.object({
  projectId: z.number().int(),
  episodeId: z.number().int().nullable(),
  sequenceIds: z.array(z.number().int()).min(1).max(500),
});
router.post('/assign', manage, validate({ body: assignBody }), async (req, res) => {
  const { projectId, episodeId, sequenceIds } = req.body as z.infer<typeof assignBody>;
  await assertProjectAccess(req, projectId);
  await assertProjectWritable(projectId);
  res.json({ count: await EpisodeService.assignSequences(projectId, episodeId, sequenceIds) });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await projectOf(req, id);
  await EpisodeService.assertEnabled(projectId);
  res.json({ episode: await EpisodeService.getDetail(id) });
});

router.patch(
  '/:id',
  manage,
  validate({
    params: idParam,
    body: episodeBody.partial().extend({
      description: z.string().max(2000).nullable().optional(),
      pipelineStatusId: z.number().int().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await projectOf(req, id);
    await assertProjectWritable(projectId);
    const body = req.body as EpisodeService.UpdateEpisodeInput;
    // Same guard as for a sequence: the status must come from the vocabulary of THIS project.
    // The episode shares the "sequence" scope (cf. schema.prisma).
    if (body.pipelineStatusId !== undefined) {
      await PipelineStatusService.assertBelongsToProject(projectId, 'sequence', body.pipelineStatusId);
    }
    res.json({ episode: await EpisodeService.update(id, projectId, body) });
  },
);

// ── Trash ─────────────────────────────────────────────────────────────────
// Shared mounting, like sequences, shots and assets: the project's trash and the multiple selection
// access it through the same paths.
mountTrashRoutes(router, {
  entityType: 'Episode',
  auditPrefix: 'EPISODE',
  notFoundMessage: 'Episode not found',
  resolveProjectId: resolveProjectIdForEpisode,
  softDelete: (_userId, id) => softDeleteEpisode(id),
  restore: restoreEpisode,
  purge: (_userId, id) => purgeEpisode(id),
});

export default router;
