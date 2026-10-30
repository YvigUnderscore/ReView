// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { assertProjectAccess, requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as ReviewDecisionService from '../services/ReviewDecisionService';

/**
 * Customizable review statuses of the studio (Phase 31.A).
 * Reading for everyone (badges and filters); CRUD reserved to ADMIN (Contexts tab).
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hex attendue (#RRGGBB)');
const statusBody = z.object({
  name: z.string().min(1).max(40),
  color: colorSchema,
  order: z.number().int().min(0).optional(),
  isApproval: z.boolean().optional(),
  isRetake: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

// GET /api/review-statuses[?projectId=]: ordered list (creates the classic statuses on first access).
// For a project linked to ShotGrid, restricted to the site's vocabulary.
router.get(
  '/',
  validate({ query: z.object({ projectId: z.coerce.number().int().positive().optional() }) }),
  async (req, res) => {
    // Express 5: `req.query` is not replaced by validation, only merged: the value may remain a string.
    // We convert it explicitly.
    const raw = req.query.projectId;
    const projectId = raw === undefined ? undefined : Number(raw);
    if (!projectId || !Number.isInteger(projectId))
      return res.json({ statuses: await ReviewDecisionService.listStatuses() });
    // A project's restricted vocabulary tells whether it exists, whether it is linked to a ShotGrid site,
    // and what can be posted to it: an arbitrary `projectId` enumerated the whole studio from any account,
    // client sharing included.
    await assertProjectAccess(req, projectId);
    res.json({ statuses: await ReviewDecisionService.listStatusesForProject(projectId) });
  },
);

// POST /api/review-statuses — ADMIN
router.post('/', requireRole(Role.ADMIN), validate({ body: statusBody }), async (req, res) => {
  res.status(201).json({ status: await ReviewDecisionService.createStatus(requireUser(req), req.body) });
});

// PATCH /api/review-statuses/:id — ADMIN
router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: statusBody.partial() }),
  async (req, res) => {
    res.json({
      status: await ReviewDecisionService.updateStatus(requireUser(req), Number(req.params.id), req.body),
    });
  },
);

// DELETE /api/review-statuses/:id — ADMIN (409 if used by decisions)
router.delete('/:id', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  await ReviewDecisionService.deleteStatus(requireUser(req), Number(req.params.id));
  res.status(204).end();
});

export default router;
