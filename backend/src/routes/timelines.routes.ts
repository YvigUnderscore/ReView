// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireUser } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as TimelineService from '../services/TimelineService';
import * as CommentService from '../services/CommentService';

/**
 * Automatic timelines (Phase 45): one per sequence, one for the whole project.
 *
 * The timeline is never "created" explicitly: it is resolved on first access. The writes are limited to
 * what a human decides: the name, the target step, and the frozen revisions.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/** Resolves a timeline's project and access assertion (RBAC), returns the projectId. */
async function assertTimelineAccess(req: Request, id: number): Promise<number> {
  const timeline = await prisma.timeline.findUnique({ where: { id }, select: { projectId: true } });
  if (!timeline) throw notFound('Timeline not found');
  await assertProjectAccess(req, timeline.projectId);
  return timeline.projectId;
}

/**
 * GET /api/timelines?projectId=X[&sequenceId=Y]: the current timeline.
 * Without `sequenceId`, it is the timeline of the whole project (all sequences end to end).
 */
router.get(
  '/',
  validate({
    query: z.object({
      projectId: z.coerce.number().int(),
      sequenceId: z.coerce.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const sequenceId = req.query.sequenceId !== undefined ? Number(req.query.sequenceId) : null;
    const timeline = await TimelineService.ensure(projectId, sequenceId);
    res.json({ timeline: await TimelineService.resolve(timeline.id) });
  },
);

// GET /api/timelines/:id — recalculation of the timeline (never stored content).
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.json({ timeline: await TimelineService.resolve(id) });
});

// PATCH /api/timelines/:id — rename, or target a step (supervisor and above).
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      name: z.string().max(120).nullable().optional(),
      department: z.string().max(40).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    await assertTimelineAccess(req, id);
    await TimelineService.update(requireUser(req), id, req.body as TimelineService.UpdateTimelineInput);
    res.json({ timeline: await TimelineService.resolve(id) });
  },
);

// GET /api/timelines/:id/snapshots — frozen revisions.
router.get('/:id/snapshots', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.json({ snapshots: await TimelineService.listSnapshots(id) });
});

// POST /api/timelines/:id/snapshots — freezes the current state (supervisor and above).
router.post(
  '/:id/snapshots',
  validate({ params: idParam, body: z.object({ note: z.string().max(500).optional() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    await assertTimelineAccess(req, id);
    const { note } = req.body as { note?: string };
    res.status(201).json({ snapshot: await TimelineService.snapshot(requireUser(req), id, note) });
  },
);

/**
 * GET /api/timelines/:id/snapshots/:revision: a revision and its difference from the previous one:
 * shots added, removed, re-versioned.
 */
router.get(
  '/:id/snapshots/:revision',
  validate({ params: idParam.extend({ revision: z.coerce.number().int().min(1) }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    await assertTimelineAccess(req, id);
    res.json(await TimelineService.getSnapshot(id, Number(req.params.revision)));
  },
);

/**
 * GET /api/timelines/:id/comments: the feedback posted on the timeline (Phase 46), in the order of the film.
 * They are written via `POST /api/comments` with `timelineId`.
 */
router.get('/:id/comments', validate({ params: idParam, query: paginationQuery }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.json(await CommentService.listMontage(id, readPagination(req.query)));
});

// GET /api/timelines/:id/export — is a master available? (signed URL if so)
router.get('/:id/export', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.json(await TimelineService.exportState(id));
});

/**
 * POST /api/timelines/:id/export: encodes the timeline into a single file (supervisor and above).
 * Chained playback has nothing to encode; this master serves sending outside the application.
 */
router.post('/:id/export', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.status(202).json(await TimelineService.requestExport(requireUser(req), id));
});

export default router;
