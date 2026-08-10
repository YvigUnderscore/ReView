// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { TaskStatus, TaskType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { notFound } from '../../lib/errors';
import { assertProjectWritable } from '../../lib/projectGuard';
import { assertCanContribute } from '../../lib/projectRoles';
import { taskSelect, versionSelect, toTask, toVersion } from '../../lib/v1Resources';
import * as Ensure from '../../services/PipelineEnsureService';
import * as ApiEventService from '../../services/ApiEventService';
import * as TaskService from '../../services/TaskService';
import { idParam, actorOf, requireShotProject, requireAssetProject, requireTaskProject } from './helpers';

/**
 * Tâches de l'API v1 : celles d'un shot ou d'un asset porteur, puis la tâche elle-même
 * et ses versions. Un shot et un asset portent leurs tâches de la même façon — d'où les
 * fabriques ci-dessous, qui ne diffèrent que par la clé de rattachement.
 */
const router = Router();

const taskBody = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.nativeEnum(TaskType).optional(),
});

/** Garde d'accès d'un porteur de tâches : elle rend l'identifiant de son projet. */
type OwnerGuard = (req: Request, id: number) => Promise<number>;

/** GET des tâches d'un porteur (shot ou asset), dans l'ordre du pipeline. */
const listTasksOf =
  (requireProject: OwnerGuard, key: 'shotId' | 'assetId'): RequestHandler =>
  async (req, res) => {
    const id = Number(req.params.id);
    await requireProject(req, id);
    const rows = await prisma.task.findMany({
      where: { [key]: id },
      orderBy: { order: 'asc' },
      select: taskSelect,
    });
    res.json({ tasks: rows.map(toTask) });
  };

/** POST idempotent d'une tâche sur un porteur (shot ou asset). */
const ensureTaskOn =
  (requireProject: OwnerGuard, key: 'shotId' | 'assetId'): RequestHandler =>
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireProject(req, id);
    const { entity, created } = await Ensure.ensureTask(
      actorOf(req),
      projectId,
      { [key]: id },
      req.body as Ensure.EnsureTaskInput,
    );
    if (created) {
      ApiEventService.publish('task.created', {
        projectId,
        entityType: 'task',
        entityId: entity.id,
        actorId: req.user!.id,
        payload: { task: toTask(entity) },
      });
    }
    res.status(created ? 201 : 200).json({ task: toTask(entity), created });
  };

router.get(
  '/shots/:id/tasks',
  requireScope('tasks:read'),
  validate({ params: idParam }),
  listTasksOf(requireShotProject, 'shotId'),
);

router.post(
  '/shots/:id/tasks',
  requireScope('tasks:write'),
  validate({ params: idParam, body: taskBody }),
  ensureTaskOn(requireShotProject, 'shotId'),
);

router.get(
  '/assets/:id/tasks',
  requireScope('tasks:read'),
  validate({ params: idParam }),
  listTasksOf(requireAssetProject, 'assetId'),
);

router.post(
  '/assets/:id/tasks',
  requireScope('tasks:write'),
  validate({ params: idParam, body: taskBody }),
  ensureTaskOn(requireAssetProject, 'assetId'),
);

router.get('/tasks/:id', requireScope('tasks:read'), validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await requireTaskProject(req, id);
  const task = await prisma.task.findUnique({ where: { id }, select: taskSelect });
  if (!task) throw notFound('Tâche introuvable');
  res.json({ task: toTask(task) });
});

// PATCH /api/v1/tasks/:id — statut et assignation, le minimum qu'un pipeline pilote
router.patch(
  '/tasks/:id',
  requireScope('tasks:write'),
  validate({
    params: idParam,
    body: z.object({
      status: z.nativeEnum(TaskStatus).optional(),
      assigneeId: z.number().int().positive().nullable().optional(),
      dueDate: z.coerce.date().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireTaskProject(req, id);
    await assertProjectWritable(projectId);
    await assertCanContribute(req.user!.id, req.user!.role, projectId);
    const body = req.body as TaskService.ApiPatchInput;
    res.json({ task: await TaskService.applyApiPatch(req.user!.id, projectId, id, body) });
  },
);

router.get(
  '/tasks/:id/versions',
  requireScope('versions:read'),
  validate({ params: idParam }),
  async (req, res) => {
    const id = Number(req.params.id);
    await requireTaskProject(req, id);
    const rows = await prisma.version.findMany({
      where: { taskId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: versionSelect,
    });
    res.json({ versions: rows.map(toVersion) });
  },
);

router.post(
  '/tasks/:id/versions',
  requireScope('versions:write'),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().trim().min(1).max(60).optional(),
      reuseExisting: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await requireTaskProject(req, id);
    const { entity, created } = await Ensure.ensureVersion(
      actorOf(req),
      projectId,
      { taskId: id },
      req.body as Ensure.EnsureVersionInput,
    );
    if (created) {
      ApiEventService.publish('version.created', {
        projectId,
        entityType: 'version',
        entityId: entity.id,
        actorId: req.user!.id,
        payload: { version: toVersion(entity) },
      });
    }
    res.status(created ? 201 : 200).json({ version: toVersion(entity), created });
  },
);

export default router;
