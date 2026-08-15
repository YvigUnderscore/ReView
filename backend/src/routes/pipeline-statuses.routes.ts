// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, TaskStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as PipelineStatusService from '../services/PipelineStatusService';

/**
 * Statuts de tâche et de plan personnalisables (Phase 48).
 * Lecture pour tous (badges, colonnes du kanban) ; administration réservée aux ADMIN.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const scopeSchema = z.enum(['task', 'shot']);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)');

const statusBody = z.object({
  scope: scopeSchema,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  color: colorSchema,
  order: z.number().int().min(0).optional(),
  isDone: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  legacyStatus: z.nativeEnum(TaskStatus).nullish(),
});

router.get('/', validate({ query: z.object({ scope: scopeSchema.optional() }) }), async (req, res) => {
  res.json({ statuses: await PipelineStatusService.list(req.query.scope as 'task' | 'shot' | undefined) });
});

router.post('/', requireRole(Role.ADMIN), validate({ body: statusBody }), async (req, res) => {
  res.status(201).json({ status: await PipelineStatusService.create(req.body) });
});

router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: statusBody.partial() }),
  async (req, res) => {
    res.json({ status: await PipelineStatusService.update(Number(req.params.id), req.body) });
  },
);

router.delete('/:id', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  await PipelineStatusService.remove(Number(req.params.id));
  res.status(204).end();
});

router.post(
  '/reorder',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ scope: scopeSchema, ids: z.array(z.number().int().positive()) }) }),
  async (req, res) => {
    res.json({ statuses: await PipelineStatusService.reorder(req.body.scope, req.body.ids) });
  },
);

export default router;
