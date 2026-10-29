// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { VisitTargetType } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  resolveProjectIdForAsset,
  resolveProjectIdForMedia,
  resolveProjectIdForProject,
  resolveProjectIdForSequence,
  resolveProjectIdForShot,
  resolveProjectIdForTask,
} from '../lib/pipeline';
import { notFound } from '../lib/errors';
import * as EntityVisitService from '../services/EntityVisitService';

/**
 * Visit acknowledgement (Phase 50, batch 9): "I opened it, turn off the glow".
 *
 * A visit is strictly personal: it says nothing about the entity, everything about its reader. Access
 * is still checked all the same: marking as visited something one may not read would be meaningless,
 * and the response would confirm the entity's existence along the way.
 *
 * This router is mounted on `/api/visits`, not on `/api`: `router.use(authenticate)` is therefore safe
 * here.
 */

const router = Router();
router.use(authenticate);

/**
 * Types it knows how to authorize: those whose owning project can be resolved.
 *
 * The Prisma enum has eight members (the mechanism's shape is known), but the route only accepts six:
 * playlist and board have no project resolver. A plain 400 is better than a write made without an
 * access check.
 */
const PROJECT_OF: Partial<Record<VisitTargetType, (id: number) => Promise<number | null>>> = {
  [VisitTargetType.PROJECT]: resolveProjectIdForProject,
  [VisitTargetType.SEQUENCE]: resolveProjectIdForSequence,
  [VisitTargetType.SHOT]: resolveProjectIdForShot,
  [VisitTargetType.ASSET]: resolveProjectIdForAsset,
  [VisitTargetType.TASK]: resolveProjectIdForTask,
  [VisitTargetType.MEDIA]: resolveProjectIdForMedia,
};

const targetTypeSchema = z.enum(['PROJECT', 'SEQUENCE', 'SHOT', 'ASSET', 'TASK', 'MEDIA']);

/** Types whose list carries a "mark all as read" button. */
const listTypeSchema = z.enum(['SEQUENCE', 'SHOT', 'ASSET']);

// POST /api/visits: I open this entity: the glow goes out for me alone.
router.post(
  '/',
  validate({
    body: z.object({
      targetType: targetTypeSchema,
      targetId: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    const { targetType, targetId } = req.body as {
      targetType: z.infer<typeof targetTypeSchema>;
      targetId: number;
    };
    const resolve = PROJECT_OF[targetType];
    const projectId = resolve ? await resolve(targetId) : null;
    if (!projectId) throw notFound('Target not found');
    await assertProjectAccess(req, projectId);
    const visitedAt = await EntityVisitService.markVisited(req.user!.id, targetType, targetId);
    res.json({ visitedAt: visitedAt.toISOString() });
  },
);

// POST /api/visits/mark-all: "mark everything as read" for a list of a project.
router.post(
  '/mark-all',
  validate({
    body: z.object({
      targetType: listTypeSchema,
      projectId: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    const { targetType, projectId } = req.body as {
      targetType: z.infer<typeof listTypeSchema>;
      projectId: number;
    };
    await assertProjectAccess(req, projectId);
    // The ids come from the database, never from the request body (see the service).
    const ids = await EntityVisitService.visitableIdsOfProject(projectId, targetType);
    res.json({ marked: await EntityVisitService.markManyVisited(req.user!.id, targetType, ids) });
  },
);

export default router;
