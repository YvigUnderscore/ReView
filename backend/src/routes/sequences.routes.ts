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
import { logAudit } from '../services/AuditService';
import { assertProjectWritable } from '../lib/projectGuard';
import { badRequest, notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

// Champs d'une séquence (création). PATCH les rend optionnels via `.partial()`.
const sequenceBody = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(60),
  order: z.number().int().optional(),
  settings: pipelineOverrideSchema.optional(),
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
    if (await prisma.sequence.findUnique({ where: { projectId_code: { projectId, code } } })) {
      throw badRequest('Une séquence avec ce code existe déjà', 'CODE_TAKEN');
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
    const { projectId, items } = req.body as {
      projectId: number;
      items: { name: string; code: string; order?: number }[];
    };
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId); // 38.B
    // Doublons dans le lot ou déjà existants → rejet global (rien n'est créé)
    const codes = items.map((i) => i.code);
    const dupInBatch = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dupInBatch) throw badRequest(`Code en double dans le lot : ${dupInBatch}`, 'CODE_DUP');
    const existing = await prisma.sequence.findMany({
      where: { projectId, code: { in: codes }, deletedAt: null },
      select: { code: true },
    });
    if (existing.length > 0) {
      throw badRequest(`Code(s) déjà existant(s) : ${existing.map((e) => e.code).join(', ')}`, 'CODE_TAKEN');
    }
    const created = await prisma.$transaction(
      items.map((it, idx) =>
        prisma.sequence.create({ data: { projectId, name: it.name, code: it.code, order: it.order ?? idx } }),
      ),
    );
    res.status(201).json({ sequences: created });
  },
);

// GET /api/sequences/:id
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const sequence = await prisma.sequence.findUnique({
    where: { id },
    include: {
      shots: {
        where: { deletedAt: null },
        orderBy: { order: 'asc' },
        include: {
          _count: { select: { tasks: true } },
          assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
        },
      },
      assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
    },
  });
  if (!sequence) throw notFound('Séquence introuvable');
  await assertProjectAccess(req, sequence.projectId);
  res.json({ sequence });
});

// PATCH /api/sequences/:id (admin/superviseur)
router.patch(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: sequenceBody.partial(),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForSequence(id);
    if (!projectId) throw notFound('Séquence introuvable');
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId); // 38.B
    const sequence = await prisma.sequence.update({ where: { id }, data: req.body });
    res.json({ sequence });
  },
);

// DELETE /api/sequences/:id — corbeille (soft-delete, admin/superviseur)
router.delete(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForSequence(id);
    if (!projectId) throw notFound('Séquence introuvable');
    await assertProjectAccess(req, projectId);
    await softDeleteSequence(id);
    logAudit({ userId: req.user!.id, action: 'SEQUENCE_DELETE', entityType: 'Sequence', entityId: id });
    res.status(204).end();
  },
);

// POST /api/sequences/:id/restore (admin/superviseur)
router.post(
  '/:id/restore',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForSequence(id);
    if (!projectId) throw notFound('Séquence introuvable');
    await assertProjectAccess(req, projectId);
    await restoreSequence(id);
    res.status(204).end();
  },
);

// DELETE /api/sequences/:id/purge — suppression définitive (admin/superviseur)
router.delete(
  '/:id/purge',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForSequence(id);
    if (!projectId) throw notFound('Séquence introuvable');
    await assertProjectAccess(req, projectId);
    await purgeSequence(id);
    logAudit({ userId: req.user!.id, action: 'SEQUENCE_PURGE', entityType: 'Sequence', entityId: id });
    res.status(204).end();
  },
);

export default router;
