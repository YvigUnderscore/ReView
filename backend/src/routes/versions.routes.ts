// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { VersionStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
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

/** Résout le projet d'une version + assertion d'accès (RBAC) → renvoie le projectId. */
async function resolveVersionAccess(req: Request, id: number): Promise<number> {
  const projectId = await resolveProjectIdForVersion(id);
  if (!projectId) throw notFound('Version not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

/** Résout le projet d'un parent Task XOR Asset + assertion d'accès. */
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
    res.json({ versions: await VersionService.list(req.user!.id, taskId, assetId) });
  },
);

// POST /api/versions — artiste+ ; rattachée à une Task XOR un Asset
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
    // Le droit de contribuer se lit sur le rôle EFFECTIF (38.E), asserté par le service :
    // tester `req.user.role === CLIENT` ici laissait passer un membre rétrogradé CLIENT sur
    // ce projet et refusait un ARTIST promu SUPERVISOR dessus.
    res.status(201).json({ version: await VersionService.create(req.user!, projectId, body) });
  },
);

// GET /api/versions/:id (avec médias)
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveVersionAccess(req, id);
  res.json({ version: await VersionService.getDetail(req.user!.id, id) });
});

// PATCH /api/versions/:id — auteur ou superviseur+. Publication (PUBLISHED) réservée superviseur+.
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      name: z.string().min(1).max(60).optional(),
      status: z.nativeEnum(VersionStatus).optional(),
      transform: z.any().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveVersionAccess(req, id);
    res.json({ version: await VersionService.update(req.user!, projectId, id, req.body) });
  },
);

/**
 * POST /api/versions/:id/publish — publie d'un geste tous les brouillons de la version
 * (Phase 46). La version bascule publiée dès qu'il ne lui reste plus un seul brouillon.
 */
router.post('/:id/publish', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveVersionAccess(req, id);
  // Contribution jugée sur le rôle effectif du projet (38.E) — assertée par le service.
  res.json(await VersionService.publishAll(req.user!, projectId, id));
});

// DELETE /api/versions/:id — corbeille (soft-delete, auteur ou superviseur+)
router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveVersionAccess(req, id);
  await VersionService.remove(req.user!, projectId, id);
  res.status(204).end();
});

// POST /api/versions/:id/restore — auteur ou superviseur+
router.post('/:id/restore', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveVersionAccess(req, id);
  await VersionService.restore(req.user!, projectId, id);
  res.status(204).end();
});

// POST /api/versions/:id/decision — décision de review (SUPERVISOR+), historisée (Phase 31)
router.post(
  '/:id/decision',
  validate({
    params: idParam,
    body: z.object({ statusId: z.number().int(), comment: z.string().max(2000).optional() }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveVersionAccess(req, id);
    // Décider d'une review est un acte de supervision DE CE PROJET : le rôle effectif fait
    // foi (38.E), pas le rôle global — sinon le superviseur nommé sur le projet en est exclu.
    await assertProjectManage(req.user!.id, req.user!.role, projectId);
    const { statusId, comment } = req.body as { statusId: number; comment?: string };
    res.status(201).json({
      decision: await ReviewDecisionService.decide(req.user!, projectId, id, statusId, comment),
    });
  },
);

// GET /api/versions/:id/decisions — historique des décisions (membres du projet)
router.get('/:id/decisions', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveVersionAccess(req, id);
  res.json({ decisions: await ReviewDecisionService.history(id) });
});

// DELETE /api/versions/:id/purge — suppression définitive (superviseur+)
router.delete('/:id/purge', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveVersionAccess(req, id);
  await VersionService.purge(req.user!, projectId, id);
  res.status(204).end();
});

export default router;
