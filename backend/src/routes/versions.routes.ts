// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { VersionStatus } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  resolveProjectIdForVersion,
  resolveProjectIdForTask,
  resolveProjectIdForAsset,
} from '../lib/pipeline';
import { assertProjectManage } from '../lib/projectRoles';
import { badRequest, notFound } from '../lib/errors';
import * as VersionService from '../services/VersionService';
import * as ReviewDecisionService from '../services/ReviewDecisionService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/**
 * Display transform of a 3D version (A2-04): orientation in degrees + uniform scale, exactly what
 * `useSaveTransform` sends and `applyEulerTransform` reads. It used to be a `z.any()`, i.e. a Json column
 * that any project member could fill with whatever shape and size they wanted, up to the body-parser limit.
 *
 * Writing is strict, reading stays tolerant: transforms inherited from the old viewer are still read
 * back as they are on the front end, which merges them with its defaults. Fields are optional, but
 * there are no free-form fields.
 */
const transformSchema = z
  .object({
    yaw: z.number().finite().min(-3_600).max(3_600).optional(),
    pitch: z.number().finite().min(-3_600).max(3_600).optional(),
    roll: z.number().finite().min(-3_600).max(3_600).optional(),
    scale: z.number().finite().min(0.000_1).max(10_000).optional(),
  })
  .strict();

/** Resolves a version's project and asserts access (RBAC); returns the projectId. */
async function resolveVersionAccess(req: Request, id: number): Promise<number> {
  const projectId = await resolveProjectIdForVersion(id);
  if (!projectId) throw notFound('Version not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

/** Resolves the project of a parent that is either a Task XOR an Asset, and asserts access. */
async function resolveParentAccess(req: Request, taskId?: number, assetId?: number): Promise<number> {
  const projectId = taskId ? await resolveProjectIdForTask(taskId) : await resolveProjectIdForAsset(assetId!);
  if (!projectId) throw notFound('Parent not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

// GET /api/versions?taskId=X | ?assetId=Y
router.get(
  '/',
  validate({
    query: z
      .object({ taskId: z.coerce.number().int().optional(), assetId: z.coerce.number().int().optional() })
      .refine((q) => q.taskId !== undefined || q.assetId !== undefined, 'taskId ou assetId requis'),
  }),
  async (req, res) => {
    const taskId = req.query.taskId ? Number(req.query.taskId) : undefined;
    const assetId = req.query.assetId ? Number(req.query.assetId) : undefined;
    await resolveParentAccess(req, taskId, assetId);
    res.json({ versions: await VersionService.list(requireUser(req).id, taskId, assetId) });
  },
);

// POST /api/versions: artist+; attached to a Task XOR an Asset
router.post(
  '/',
  validate({
    body: z
      .object({
        taskId: z.number().int().optional(),
        assetId: z.number().int().optional(),
        name: z.string().min(1).max(60).optional(),
      })
      .refine(
        (b) => (b.taskId === undefined) !== (b.assetId === undefined),
        'Fournir exactement taskId OU assetId',
      ),
  }),
  async (req, res) => {
    const body = req.body as { taskId?: number; assetId?: number; name?: string };
    const projectId =
      body.taskId !== undefined
        ? await resolveProjectIdForTask(body.taskId)
        : await resolveProjectIdForAsset(body.assetId!);
    if (!projectId) throw badRequest('Parent task or asset not found');
    await assertProjectAccess(req, projectId);
    // Contribution rights are read from the EFFECTIVE role (38.E), asserted by the service:
    // testing `req.user.role === CLIENT` here would let a member demoted to CLIENT on this project
    // through, and refuse an ARTIST promoted to SUPERVISOR on it.
    res.status(201).json({ version: await VersionService.create(requireUser(req), projectId, body) });
  },
);

// GET /api/versions/:id (with media)
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveVersionAccess(req, id);
  res.json({ version: await VersionService.getDetail(requireUser(req).id, id) });
});

// PATCH /api/versions/:id: author or supervisor+. Publication (PUBLISHED) reserved to supervisor+.
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      name: z.string().min(1).max(60).optional(),
      status: z.nativeEnum(VersionStatus).optional(),
      transform: transformSchema.optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveVersionAccess(req, id);
    res.json({ version: await VersionService.update(requireUser(req), projectId, id, req.body) });
  },
);

/**
 * POST /api/versions/:id/publish: publishes all of the version's drafts in one gesture (Phase 46).
 * The version flips to published as soon as no draft remains.
 */
router.post('/:id/publish', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveVersionAccess(req, id);
  // Contribution judged on the project's effective role (38.E), asserted by the service.
  res.json(await VersionService.publishAll(requireUser(req), projectId, id));
});

// DELETE /api/versions/:id: trash (soft-delete, author or supervisor+)
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveVersionAccess(req, id);
  await VersionService.remove(requireUser(req), projectId, id);
  res.status(204).end();
});

// POST /api/versions/:id/restore: author or supervisor+
router.post('/:id/restore', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveVersionAccess(req, id);
  await VersionService.restore(requireUser(req), projectId, id);
  res.status(204).end();
});

// POST /api/versions/:id/decision: review decision (SUPERVISOR+), recorded in history (Phase 31)
router.post(
  '/:id/decision',
  validate({
    params: idParam,
    body: z.object({ statusId: z.number().int(), comment: z.string().max(2000).optional() }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveVersionAccess(req, id);
    // Deciding a review is a supervision act ON THIS PROJECT: the effective role counts (38.E), not the
    // global role, otherwise a supervisor named on the project would be excluded.
    await assertProjectManage(requireUser(req).id, requireUser(req).role, projectId);
    const { statusId, comment } = req.body as { statusId: number; comment?: string };
    res.status(201).json({
      decision: await ReviewDecisionService.decide(requireUser(req), projectId, id, statusId, comment),
    });
  },
);

// GET /api/versions/:id/decisions: decision history (project members)
router.get('/:id/decisions', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveVersionAccess(req, id);
  res.json({ decisions: await ReviewDecisionService.history(id) });
});

// DELETE /api/versions/:id/purge: permanent deletion (supervisor+)
router.delete('/:id/purge', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveVersionAccess(req, id);
  await VersionService.purge(requireUser(req), projectId, id);
  res.status(204).end();
});

export default router;
