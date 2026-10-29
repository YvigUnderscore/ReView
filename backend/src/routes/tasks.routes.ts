// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { TaskType, TaskStatus } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForTask, resolveProjectIdForShot, resolveProjectIdForAsset } from '../lib/pipeline';
import { assertProjectManage } from '../lib/projectRoles';
import { notFound } from '../lib/errors';
import { MAX_PAGE_SIZE, cursorPaginationQuery, readPagination } from '../lib/pagination';
import { taskDescriptionField } from '../lib/taskPayload';
import * as TaskService from '../services/TaskService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/** Resolves a task's project and access assertion (RBAC), returns the projectId. */
async function resolveTaskAccess(req: Request, id: number): Promise<number> {
  const projectId = await resolveProjectIdForTask(id);
  if (!projectId) throw notFound('Task not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

/**
 * GET /api/tasks/board?projectId=[&limit=][&cursor=]: the project's tasks (C4).
 *
 * `cursor` resumes after the last task served: with ten thousand tasks, the board fills in several bounded
 * calls instead of one single response that no browser likes to receive. Without a cursor, the behavior is
 * that of before.
 *
 * Declared before `/:id` so that "board" is not read as an identifier.
 */
router.get(
  '/board',
  validate({
    query: z.object({
      projectId: z.coerce.number().int(),
      limit: z.coerce.number().int().min(1).max(5000).optional(),
      cursor: z.string().min(1).max(300).optional(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    res.json(await TaskService.listForBoard(projectId, limit, cursor));
  },
);

// GET /api/tasks?shotId=X | ?assetId=Y — paginated (10.D1)
router.get(
  '/',
  validate({
    query: z
      .object({
        shotId: z.coerce.number().int().optional(),
        assetId: z.coerce.number().int().optional(),
        // All the project's tasks, whatever their parent: that is what is needed to offer an upload
        // destination on a project where an asset goes through five steps and each shot as many.
        projectId: z.coerce.number().int().optional(),
      })
      .merge(cursorPaginationQuery)
      .refine(
        (q) => q.shotId !== undefined || q.assetId !== undefined || q.projectId !== undefined,
        'shotId, assetId ou projectId requis',
      ),
  }),
  async (req, res) => {
    const shotId = req.query.shotId ? Number(req.query.shotId) : undefined;
    const assetId = req.query.assetId ? Number(req.query.assetId) : undefined;
    const asked = req.query.projectId ? Number(req.query.projectId) : undefined;

    if (asked !== undefined && !shotId && !assetId) {
      await assertProjectAccess(req, asked);
      // List consumed in one block (upload destinations): wide page by default, but
      // `total`, `truncated` and `nextCursor` finally say what has not been served.
      const p = readPagination(req.query, { defaultPageSize: MAX_PAGE_SIZE });
      const { items, total, truncated, nextCursor } = await TaskService.listForProject(asked, p);
      return res.json({ tasks: items, total, truncated, nextCursor });
    }

    const projectId = shotId
      ? await resolveProjectIdForShot(shotId)
      : await resolveProjectIdForAsset(assetId!);
    if (!projectId) throw notFound('Parent not found');
    await assertProjectAccess(req, projectId);
    res.json(await TaskService.list(readPagination(req.query), shotId, assetId));
  },
);

// POST /api/tasks (admin and supervisor) — attached to a Shot XOR an Asset
router.post(
  '/',
  validate({
    body: z
      .object({
        name: z.string().min(1).max(160),
        type: z.nativeEnum(TaskType).default(TaskType.OTHER),
        department: z.string().min(1).max(40).nullable().optional(),
        // Task brief (Phase 50): what there is to do, in plain text.
        description: taskDescriptionField,
        shotId: z.number().int().optional(),
        assetId: z.number().int().optional(),
        assigneeId: z.number().int().nullable().optional(),
        order: z.number().int().optional(),
      })
      .refine(
        (b) => (b.shotId === undefined) !== (b.assetId === undefined),
        'Fournir exactement shotId OU assetId',
      ),
  }),
  async (req, res) => {
    const body = req.body as { shotId?: number; assetId?: number };
    const projectId =
      body.shotId !== undefined
        ? await resolveProjectIdForShot(body.shotId)
        : await resolveProjectIdForAsset(body.assetId!);
    if (!projectId) throw notFound('Parent shot or asset not found');
    await assertProjectAccess(req, projectId);
    // Rights read on the EFFECTIVE role (38.E): the check read the GLOBAL role, so a lead supervising their
    // project (a role given by membership) was refused the creation of a task that the service grants them.
    // It was the only creation path outside ShotGrid: a standalone project's pipe stayed closed to them.
    await assertProjectManage(requireUser(req).id, requireUser(req).role, projectId);
    res.status(201).json({ task: await TaskService.create(requireUser(req), projectId, req.body) });
  },
);

// GET /api/tasks/:id
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveTaskAccess(req, id);
  res.json({ task: await TaskService.getDetail(id) });
});

// PATCH /api/tasks/:id — supervisor and admin: all fields; assignee: status only
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      type: z.nativeEnum(TaskType).optional(),
      department: z.string().min(1).max(40).nullable().optional(),
      description: taskDescriptionField,
      status: z.nativeEnum(TaskStatus).optional(),
      // Customizable status (Phase 48): both forms are accepted and aligned by the service: the kanban sends
      // one, older clients the other.
      pipelineStatusId: z.number().int().nullable().optional(),
      assigneeId: z.number().int().nullable().optional(),
      order: z.number().int().optional(),
      // Scheduling (43.C): start and due date (supervisors), null to clear.
      startDate: z.coerce.date().nullable().optional(),
      dueDate: z.coerce.date().nullable().optional(),
      // Checklist (38.F): [{ text, done }], tickable by the assignee.
      checklist: z
        .array(z.object({ text: z.string().min(1).max(200), done: z.boolean() }))
        .max(100)
        .optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveTaskAccess(req, id);
    res.json({ task: await TaskService.update(requireUser(req), projectId, id, req.body) });
  },
);

// DELETE /api/tasks/:id (admin and supervisor)
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveTaskAccess(req, id);
  await TaskService.remove(requireUser(req), projectId, id);
  res.status(204).end();
});

export default router;
