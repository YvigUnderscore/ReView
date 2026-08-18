// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { Role, TaskType, TaskStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForTask, resolveProjectIdForShot, resolveProjectIdForAsset } from '../lib/pipeline';
import { forbidden, notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as TaskService from '../services/TaskService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/** Résout le projet d'une tâche + assertion d'accès (RBAC) → renvoie le projectId. */
async function resolveTaskAccess(req: Request, id: number): Promise<number> {
  const projectId = await resolveProjectIdForTask(id);
  if (!projectId) throw notFound('Task not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

/**
 * GET /api/tasks/board?projectId= — toutes les tâches du projet, en un appel (C4).
 *
 * Déclarée avant `/:id` pour que « board » ne soit pas lu comme un identifiant.
 */
router.get(
  '/board',
  validate({
    query: z.object({
      projectId: z.coerce.number().int(),
      limit: z.coerce.number().int().min(1).max(5000).optional(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await TaskService.listForBoard(projectId, limit));
  },
);

// GET /api/tasks?shotId=X | ?assetId=Y — paginé (10.D1)
router.get(
  '/',
  validate({
    query: z
      .object({
        shotId: z.coerce.number().int().optional(),
        assetId: z.coerce.number().int().optional(),
        // Toutes les tâches du projet, quel que soit leur parent : c'est ce qu'il faut
        // pour proposer une destination d'upload sur un projet où un asset traverse
        // cinq étapes et chaque plan autant.
        projectId: z.coerce.number().int().optional(),
      })
      .merge(paginationQuery)
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
      return res.json({ tasks: await TaskService.listForProject(asked) });
    }

    const projectId = shotId
      ? await resolveProjectIdForShot(shotId)
      : await resolveProjectIdForAsset(assetId!);
    if (!projectId) throw notFound('Parent not found');
    await assertProjectAccess(req, projectId);
    res.json(await TaskService.list(readPagination(req.query), shotId, assetId));
  },
);

// POST /api/tasks (admin/superviseur) — rattachée à un Shot XOR un Asset
router.post(
  '/',
  validate({
    body: z
      .object({
        name: z.string().min(1).max(160),
        type: z.nativeEnum(TaskType).default(TaskType.OTHER),
        department: z.string().min(1).max(40).nullable().optional(),
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
    if (req.user!.role !== Role.ADMIN && req.user!.role !== Role.SUPERVISOR)
      throw forbidden('Supervisors and administrators only');
    const body = req.body as { shotId?: number; assetId?: number };
    const projectId =
      body.shotId !== undefined
        ? await resolveProjectIdForShot(body.shotId)
        : await resolveProjectIdForAsset(body.assetId!);
    if (!projectId) throw notFound('Parent shot or asset not found');
    await assertProjectAccess(req, projectId);
    res.status(201).json({ task: await TaskService.create(req.user!, projectId, req.body) });
  },
);

// GET /api/tasks/:id
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveTaskAccess(req, id);
  res.json({ task: await TaskService.getDetail(id) });
});

// PATCH /api/tasks/:id — superviseur/admin : tous champs ; assigné : statut uniquement
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      type: z.nativeEnum(TaskType).optional(),
      department: z.string().min(1).max(40).nullable().optional(),
      status: z.nativeEnum(TaskStatus).optional(),
      // Statut personnalisable (Phase 48) : les deux formes sont acceptées et alignées
      // par le service — le kanban envoie l'une, les anciens clients l'autre.
      pipelineStatusId: z.number().int().nullable().optional(),
      assigneeId: z.number().int().nullable().optional(),
      order: z.number().int().optional(),
      // Planification (43.C) : début + échéance (superviseurs) — null pour effacer.
      startDate: z.coerce.date().nullable().optional(),
      dueDate: z.coerce.date().nullable().optional(),
      // Checklist (38.F) : [{ text, done }] — cochable par l'assigné.
      checklist: z
        .array(z.object({ text: z.string().min(1).max(200), done: z.boolean() }))
        .max(100)
        .optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveTaskAccess(req, id);
    res.json({ task: await TaskService.update(req.user!, projectId, id, req.body) });
  },
);

// DELETE /api/tasks/:id (admin/superviseur)
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveTaskAccess(req, id);
  await TaskService.remove(req.user!, projectId, id);
  res.status(204).end();
});

export default router;
