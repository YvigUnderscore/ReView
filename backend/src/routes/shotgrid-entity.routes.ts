// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectManager } from '../lib/shotgridAccess';
import * as Config from '../services/shotgrid/ShotgridConfigService';
import { runSync } from '../services/shotgrid/ShotgridSyncService';
import { createTaskFromStep, listProjectMembers, listSteps } from '../services/shotgrid/ShotgridSteps';

/**
 * Realigning a single entity on ShotGrid.
 *
 * Comparing the project says what diverges, but realigning everything in one gesture is a heavy decision
 * that one does not take for a single shot. Here we re-read one specific entity: ShotGrid is
 * authoritative, the local value is rewritten from the site, and nothing else is touched. It is the
 * action called by the badge placed on a shot, an asset or a task.
 */
const router = Router();
router.use(authenticate);

const LOCAL_TYPES = ['sequence', 'shot', 'asset', 'task', 'version'] as const;

router.post(
  '/projects/:projectId/realign',
  validate({
    params: z.object({ projectId: z.coerce.number().int().positive() }),
    body: z.object({
      localType: z.enum(LOCAL_TYPES),
      localId: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    const connection = await Config.getConnection(projectId);
    if (!connection?.active) throw badRequest('Project not linked to ShotGrid');

    const link = await prisma.shotgridLink.findFirst({
      where: {
        connectionId: connection.id,
        localType: req.body.localType,
        localId: req.body.localId,
      },
      select: { sgType: true, sgId: true },
    });
    // An entity without a link does not exist there: "realigning" it would amount to creating it, which
    // the studio has precisely chosen to do from ShotGrid. We say so rather than inventing a remote entity.
    if (!link) throw notFound('This entity has no ShotGrid counterpart');

    const result = await runSync(projectId, {
      kind: 'incremental',
      onlySgIds: [{ sgType: link.sgType, sgId: link.sgId }],
      withMedia: req.body.localType === 'version',
      triggeredById: requireUser(req).id,
    });
    res.json({ status: result.status, sgType: link.sgType, sgId: link.sgId });
  },
);

/**
 * The site's pipeline steps, to create the missing task.
 *
 * The columns one sees in ShotGrid (art, model, rig, groom, lookdev) are steps, not tasks: a new asset
 * carries them all, empty. Proposing them here avoids the round trip "create the task in ShotGrid, come
 * back, resynchronize".
 */
router.get(
  '/projects/:projectId/steps',
  validate({
    params: z.object({ projectId: z.coerce.number().int().positive() }),
    query: z.object({
      entityType: z.enum(['Asset', 'Shot']),
      // By default we stick to the steps the project uses; the full catalog of the site remains
      // accessible to whoever explicitly asks for it.
      all: z.coerce.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId, { allowMembers: true });
    const connection = await Config.getConnection(projectId);
    if (!connection?.active) return res.json({ steps: [] });
    res.json({
      steps: await listSteps(projectId, req.query.entityType as 'Asset' | 'Shot', {
        // Express 5 does not replace `req.query` with the validated value: the value remains a string there,
        // whatever the Zod schema.
        all: String(req.query.all) === 'true',
      }),
    });
  },
);

router.post(
  '/projects/:projectId/tasks',
  validate({
    params: z.object({ projectId: z.coerce.number().int().positive() }),
    body: z.object({
      stepSgId: z.number().int().positive(),
      parentType: z.enum(['asset', 'shot']),
      parentId: z.number().int().positive(),
      name: z.string().min(1).max(160).optional(),
      assigneeSgId: z.number().int().positive().nullish(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId);
    res.status(201).json(await createTaskFromStep(projectId, req.body, requireUser(req).email ?? null));
  },
);

/** People assigned to the project on the site: those to whom a task can be entrusted. */
router.get(
  '/projects/:projectId/members',
  validate({ params: z.object({ projectId: z.coerce.number().int().positive() }) }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(requireUser(req), projectId, { allowMembers: true });
    const connection = await Config.getConnection(projectId);
    if (!connection?.active) return res.json({ members: [] });
    res.json({ members: await listProjectMembers(projectId) });
  },
);

export default router;
