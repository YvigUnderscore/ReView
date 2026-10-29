// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { MATCH_TYPES, VISIBILITY_TYPES } from '../lib/visibility';
import * as VisibilityService from '../services/VisibilityService';

/**
 * Hiding items: reserved to ADMIN.
 *
 * A SUPERVISOR administers their project; making a shot disappear from everyone's screens is a
 * different matter. So is reading the rules: they expose the studio's internal conventions, which an
 * artist has no use for.
 */
const router = Router();

/**
 * ⚠ Router mounted on `/api`: no `router.use(authenticate)`, since Express would run it for every
 * request passing through the mount point, public routes included.
 */
const auth = authenticate;
const admin = requireRole(Role.ADMIN);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const kindParam = z.object({
  kind: z.enum(['episode', 'sequence', 'shot', 'asset']),
  id: z.coerce.number().int().positive(),
});

const ruleBody = z.object({
  projectId: z.number().int().positive().nullish(),
  entityType: z.enum(VISIBILITY_TYPES),
  matchType: z.enum(MATCH_TYPES),
  pattern: z.string().min(1).max(200),
  ignoreCase: z.boolean().optional(),
  reason: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
});

/** The studio of this instance: one instance = one studio (see CLAUDE.md). */
async function currentStudioId(): Promise<number> {
  const project = await prisma.project.findFirst({ select: { studioId: true } });
  if (!project) throw notFound('No studio yet');
  return project.studioId;
}

router.get(
  '/visibility/rules',
  auth,
  admin,
  validate({ query: z.object({ projectId: z.coerce.number().int().positive().optional() }) }),
  async (req, res) => {
    const studioId = await currentStudioId();
    const projectId = req.query.projectId === undefined ? undefined : Number(req.query.projectId);
    res.json({ rules: await VisibilityService.listRules(studioId, projectId) });
  },
);

router.post('/visibility/rules', auth, admin, validate({ body: ruleBody }), async (req, res) => {
  const studioId = await currentStudioId();
  const { rule, applied } = await VisibilityService.createRule(studioId, req.user!.id, req.body);
  res.status(201).json({ rule, applied });
});

router.patch(
  '/visibility/rules/:id',
  auth,
  admin,
  validate({ params: idParam, body: ruleBody.partial() }),
  async (req, res) => {
    const studioId = await currentStudioId();
    const { rule, applied } = await VisibilityService.updateRule(studioId, Number(req.params.id), req.body);
    res.json({ rule, applied });
  },
);

router.delete('/visibility/rules/:id', auth, admin, validate({ params: idParam }), async (req, res) => {
  const studioId = await currentStudioId();
  res.json({ applied: await VisibilityService.deleteRule(studioId, Number(req.params.id)) });
});

/**
 * Replay the rules on demand.
 *
 * They already run on every change and after every import, but a studio that has just written a
 * batch of them wants to check the result without waiting for the next sync.
 */
router.post(
  '/visibility/apply',
  auth,
  admin,
  validate({ body: z.object({ projectId: z.number().int().positive().optional() }) }),
  async (req, res) => {
    const studioId = await currentStudioId();
    res.json({ applied: await VisibilityService.applyRules(studioId, req.body.projectId) });
  },
);

/** Hide or reveal one specific item, without writing a rule. */
router.put(
  '/visibility/:kind/:id',
  auth,
  admin,
  validate({
    params: kindParam,
    body: z.object({ hidden: z.boolean(), reason: z.string().max(500).nullish() }),
  }),
  async (req, res) => {
    await VisibilityService.setHidden(
      req.params.kind as 'episode' | 'sequence' | 'shot' | 'asset',
      Number(req.params.id),
      req.body.hidden,
      req.body.reason,
    );
    res.status(204).end();
  },
);

export default router;
