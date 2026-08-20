// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForSequence } from '../lib/pipeline';
import { pipelineOverrideSchema } from '../lib/projectSettings';
import { softDeleteSequence, restoreSequence, purgeSequence } from '../lib/trash';
import { mountTrashRoutes } from './trashRoutes';
import { assertProjectWritable } from '../lib/projectGuard';
import { badRequest, notFound } from '../lib/errors';
import { assertLocalCreationAllowed } from '../services/shotgrid/ShotgridGuardService';
import * as SequenceService from '../services/SequenceService';
import * as PipelineStatusService from '../services/PipelineStatusService';
import { enqueuePush } from '../services/shotgrid/ShotgridPushService';

const router = Router();
router.use(authenticate);

// Champs d'une séquence (création). PATCH les rend optionnels via `.partial()`.
const sequenceBody = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(60),
  order: z.number().int().optional(),
  settings: pipelineOverrideSchema.optional(),
});
/**
 * Ce que le PATCH accepte en plus (C3) : la fiche de la séquence. Description et vignette
 * viennent d'être ajoutées au modèle ; le statut, lui, existait mais n'était écrit que
 * par la synchronisation ShotGrid — un studio autonome ne pouvait pas y toucher.
 */
const sequencePatchBody = sequenceBody.partial().extend({
  description: z.string().max(2000).nullable().optional(),
  thumbnailKey: z.string().max(512).nullable().optional(),
  pipelineStatusId: z.number().int().nullable().optional(),
});
const createSequenceBody = sequenceBody.extend({ projectId: z.number().int() });
type CreateSequenceBody = z.infer<typeof createSequenceBody>;

// GET /api/sequences?projectId=X — liste les séquences d'un projet
// + `unsequencedShots` : nombre de shots du projet hors séquence (arbre sidebar)
router.get('/', validate({ query: z.object({ projectId: z.coerce.number().int() }) }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  const [sequences, unsequencedShots] = await Promise.all([
    prisma.sequence.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { order: 'asc' },
      include: { _count: { select: { shots: true } } },
    }),
    prisma.shot.count({ where: { projectId, sequenceId: null, deletedAt: null } }),
  ]);
  res.json({ sequences, unsequencedShots });
});

// POST /api/sequences (admin/superviseur)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ body: createSequenceBody }),
  async (req, res) => {
    const { projectId, name, code, order, settings } = req.body as CreateSequenceBody;
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId); // 38.B : projet archivé = lecture seule
    await assertLocalCreationAllowed(projectId, 'sequence'); // 48 : ShotGrid mène
    if (await prisma.sequence.findUnique({ where: { projectId_code: { projectId, code } } })) {
      throw badRequest('A sequence with this code already exists', 'CODE_TAKEN');
    }
    const sequence = await prisma.sequence.create({
      data: { projectId, name, code, order: order ?? 0, settings: settings ?? {} },
    });
    res.status(201).json({ sequence });
  },
);

// POST /api/sequences/bulk — création en lot (admin/superviseur)
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

// GET /api/sequences/:id — fiche complète, celle que sert la page de séquence (C3).
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const sequence = await SequenceService.getDetail(Number(req.params.id));
  await assertProjectAccess(req, sequence.projectId);
  res.json({ sequence });
});

// PATCH /api/sequences/:id (admin/superviseur)
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
    await assertProjectWritable(projectId); // 38.B
    const body = req.body as z.infer<typeof sequencePatchBody>;
    // Le statut doit appartenir au vocabulaire de CE projet, comme pour une tâche.
    if (body.pipelineStatusId !== undefined) {
      await PipelineStatusService.assertBelongsToProject(projectId, 'sequence', body.pipelineStatusId);
    }
    const sequence = await prisma.sequence.update({ where: { id }, data: body });
    // Le statut repart vers ShotGrid : sans cela, le site garde l'ancien et la
    // synchronisation suivante ramène sa valeur, effaçant le changement.
    if (body.pipelineStatusId !== undefined) {
      await enqueuePush(projectId, { type: 'sequence-status', sequenceId: id, actorId: req.user!.id });
    }
    res.json({ sequence });
  },
);

// Corbeille : mise à la corbeille, restauration, purge — montage partagé (C3).
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
