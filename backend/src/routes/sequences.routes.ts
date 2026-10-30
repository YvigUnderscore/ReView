// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForSequence } from '../lib/pipeline';
import { pipelineOverrideSchema } from '../lib/projectSettings';
import { softDeleteSequence, restoreSequence, purgeSequence } from '../lib/trash';
import { mountTrashRoutes } from './trashRoutes';
import { assertProjectWritable } from '../lib/projectGuard';
import { badRequest, notFound } from '../lib/errors';
import { assertLocalCreationAllowed } from '../services/shotgrid/ShotgridGuardService';
import { MAX_PAGE_SIZE, paginate, pageArgs, paginationQuery, readPagination } from '../lib/pagination';
import * as SequenceService from '../services/SequenceService';
import { CARD_ASSIGNEE_SELECT, awaitingReviewBySequence, signAssignees } from '../lib/entityCardData';
import * as EntityVisitService from '../services/EntityVisitService';

const router = Router();
router.use(authenticate);

// Fields of a sequence (creation). PATCH makes them optional via `.partial()`.
const sequenceBody = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(60),
  order: z.number().int().optional(),
  settings: pipelineOverrideSchema.optional(),
});
/**
 * What the PATCH accepts in addition (C3): the sequence's record. The description has just been added
 * to the model; the status, for its part, existed but was only written by the ShotGrid sync, so a
 * standalone studio could not touch it.
 *
 * The thumbnail is not part of it: it is written by `PUT /api/sequences/:id/thumbnail`, which rebuilds
 * the key and checks that it designates THIS sequence. Received from the client, it let anyone presign
 * any object in the bucket.
 */
const sequencePatchBody = sequenceBody.partial().extend({
  description: z.string().max(2000).nullable().optional(),
  pipelineStatusId: z.number().int().nullable().optional(),
});
const createSequenceBody = sequenceBody.extend({ projectId: z.number().int() });
type CreateSequenceBody = z.infer<typeof createSequenceBody>;

/**
 * GET /api/sequences?projectId=X: lists the sequences of a project, plus `unsequencedShots`, the number
 * of the project's shots outside any sequence (sidebar tree).
 *
 * The request was not bounded. The sidebar tree consumes the list in one block, hence a wide default page
 * size, but it remains a page: `total` and `hasMore` tell the truth, and `page`/`pageSize` allow reading on.
 */
router.get(
  '/',
  validate({ query: z.object({ projectId: z.coerce.number().int() }).merge(paginationQuery) }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const p = readPagination(req.query, { defaultPageSize: MAX_PAGE_SIZE });
    // `hiddenAt`: a hidden sequence disappears from the tree as from the lists.
    const where = { projectId, deletedAt: null, hiddenAt: null };
    const [sequences, total, unsequencedShots] = await Promise.all([
      prisma.sequence.findMany({
        where,
        // Tie-break on `id`: the imported sequences all share `order = 0`.
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        ...pageArgs(p),
        include: {
          _count: { select: { shots: true } },
          // Responsible people: the card shows them as photos (as for a shot).
          assignees: { select: CARD_ASSIGNEE_SELECT, orderBy: { id: 'asc' } },
        },
      }),
      prisma.sequence.count({ where }),
      prisma.shot.count({ where: { projectId, sequenceId: null, deletedAt: null, hiddenAt: null } }),
    ]);
    const { pageCount, hasMore } = paginate(sequences, total, p);
    // "Awaiting review" badge: what a sequence awaits are the published deliveries of its shots that no
    // decision has yet settled.
    const [awaiting, unseen] = await Promise.all([
      awaitingReviewBySequence(sequences.map((s) => s.id)),
      // "Not viewed" (batch 9): a sequence lights up on the activity of its shots. Publishing a media
      // writes nothing on the sequence: that is the whole trap of the batch.
      EntityVisitService.unseenBySequence(requireUser(req).id, sequences),
    ]);
    // Effective thumbnail: the one chosen by hand, otherwise that of the first published media of one of
    // its shots, without which the card of a sequence stays empty even once the work has started.
    const signed = await SequenceService.signSequenceThumbnails(await signAssignees(sequences));
    res.json({
      sequences: signed.map((s) => ({
        ...s,
        awaitingReview: awaiting.get(s.id) ?? 0,
        unseen: unseen.get(s.id) ?? false,
      })),
      unsequencedShots,
      total,
      page: p.page,
      pageSize: p.pageSize,
      pageCount,
      hasMore,
    });
  },
);

// POST /api/sequences (admin and supervisor)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ body: createSequenceBody }),
  async (req, res) => {
    const { projectId, name, code, order, settings } = req.body as CreateSequenceBody;
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId); // 38.B: archived project = read-only
    await assertLocalCreationAllowed(projectId, 'sequence'); // 48: ShotGrid leads
    if (await prisma.sequence.findUnique({ where: { projectId_code: { projectId, code } } })) {
      throw badRequest('A sequence with this code already exists', 'CODE_TAKEN');
    }
    const sequence = await prisma.sequence.create({
      data: { projectId, name, code, order: order ?? 0, settings: settings ?? {} },
    });
    res.status(201).json({ sequence });
  },
);

// POST /api/sequences/bulk — bulk creation (admin and supervisor)
router.post(
  '/bulk',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      projectId: z.number().int(),
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(160),
            code: z.string().min(1).max(60),
            order: z.number().int().optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  async (req, res) => {
    const { projectId, items } = req.body as { projectId: number; items: SequenceService.BulkSequenceItem[] };
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId); // 38.B
    res.status(201).json({ sequences: await SequenceService.createBulk(projectId, items) });
  },
);

// GET /api/sequences/:id — full record, the one served by the sequence page (C3).
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const sequence = await SequenceService.getDetail(Number(req.params.id), requireUser(req).id);
  await assertProjectAccess(req, sequence.projectId);
  res.json({ sequence });
});

// PATCH /api/sequences/:id (admin and supervisor)
router.patch(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: sequencePatchBody,
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForSequence(id);
    if (!projectId) throw notFound('Sequence not found');
    await assertProjectAccess(req, projectId);
    const body = req.body as z.infer<typeof sequencePatchBody>;
    res.json({ sequence: await SequenceService.update(id, projectId, body, requireUser(req).id) });
  },
);

// Trash: move to trash, restore, purge — shared mounting (C3).
mountTrashRoutes(router, {
  entityType: 'Sequence',
  auditPrefix: 'SEQUENCE',
  notFoundMessage: 'Sequence not found',
  resolveProjectId: resolveProjectIdForSequence,
  softDelete: (_userId, id) => softDeleteSequence(id),
  restore: restoreSequence,
  purge: (_userId, id) => purgeSequence(id),
});

export default router;
