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
 * Customizable task and shot statuses (Phase 48).
 * Reading for everyone (badges, kanban columns); administration reserved to ADMIN.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
// Sequences and assets have carried a status since phase 48, and the catalog contains them: refusing
// them here returned a 400 on every badge, which therefore stayed invisible. Manual creation remains
// reserved to the two editable scopes: the statuses of sequences and assets come from the site, which
// keeps the reference list.
const scopeSchema = z.enum(['task', 'shot', 'sequence', 'asset']);
const editableScope = z.enum(['task', 'shot']);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)');

const statusBody = z.object({
  scope: editableScope,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  color: colorSchema,
  order: z.number().int().min(0).optional(),
  isDone: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  legacyStatus: z.nativeEnum(TaskStatus).nullish(),
  // Scope of the created status (B2): absent means the studio catalog, otherwise the vocabulary
  // specific to this project.
  projectId: z.number().int().positive().nullish(),
});

router.get(
  '/',
  validate({
    query: z.object({
      scope: scopeSchema.optional(),
      // The vocabulary depends on the project: the site's on a linked project, ours otherwise.
      // Without this parameter, the whole catalog is returned: both mixed together.
      projectId: z.coerce.number().int().positive().optional(),
      // `all` ignores the sorting the studio made for this project: it is the settings screen that
      // requests it, and one does not tick a list already trimmed of itself.
      all: z.enum(['true', 'false']).optional(),
    }),
  }),
  async (req, res) => {
    // Express 5: `req.query` is not replaced by the validated value; numbers remain strings there.
    // So we re-read the raw value rather than assume it.
    const scope = req.query.scope as PipelineStatusService.Scope | undefined;
    const projectId = req.query.projectId ? Number(req.query.projectId) : null;
    const all = req.query.all === 'true';
    res.json({
      statuses: projectId
        ? await PipelineStatusService.listForProject(projectId, scope, { all })
        : await PipelineStatusService.list(scope),
    });
  },
);

router.post('/', requireRole(Role.ADMIN), validate({ body: statusBody }), async (req, res) => {
  const { projectId, ...input } = req.body as { projectId?: number | null };
  res.status(201).json({ status: await PipelineStatusService.create(input as never, projectId ?? null) });
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
