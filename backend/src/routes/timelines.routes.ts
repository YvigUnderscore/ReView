// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as TimelineService from '../services/TimelineService';
import * as CommentService from '../services/CommentService';

/**
 * Montages automatiques (Phase 45) : un par séquence, un pour le projet entier.
 *
 * Le montage n'est jamais « créé » explicitement — il est résolu au premier accès. Les
 * écritures se limitent à ce qu'un humain décide : le nom, l'étape visée, et les
 * révisions figées.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

/** Résout le projet d'un montage + assertion d'accès (RBAC) → renvoie le projectId. */
async function assertTimelineAccess(req: Request, id: number): Promise<number> {
  const timeline = await prisma.timeline.findUnique({ where: { id }, select: { projectId: true } });
  if (!timeline) throw notFound('Timeline not found');
  await assertProjectAccess(req, timeline.projectId);
  return timeline.projectId;
}

/**
 * GET /api/timelines?projectId=X[&sequenceId=Y] — le montage courant.
 * Sans `sequenceId`, c'est le montage du projet entier (toutes séquences bout à bout).
 */
router.get(
  '/',
  validate({
    query: z.object({
      projectId: z.coerce.number().int(),
      sequenceId: z.coerce.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const sequenceId = req.query.sequenceId !== undefined ? Number(req.query.sequenceId) : null;
    const timeline = await TimelineService.ensure(projectId, sequenceId);
    res.json({ timeline: await TimelineService.resolve(timeline.id) });
  },
);

// GET /api/timelines/:id — recalcul du montage (jamais un contenu stocké).
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.json({ timeline: await TimelineService.resolve(id) });
});

// PATCH /api/timelines/:id — renommer / viser une étape (superviseur+).
router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      name: z.string().max(120).nullable().optional(),
      department: z.string().max(40).nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    await assertTimelineAccess(req, id);
    await TimelineService.update(req.user!, id, req.body as TimelineService.UpdateTimelineInput);
    res.json({ timeline: await TimelineService.resolve(id) });
  },
);

// GET /api/timelines/:id/snapshots — révisions figées.
router.get('/:id/snapshots', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.json({ snapshots: await TimelineService.listSnapshots(id) });
});

// POST /api/timelines/:id/snapshots — figer l'état courant (superviseur+).
router.post(
  '/:id/snapshots',
  validate({ params: idParam, body: z.object({ note: z.string().max(500).optional() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    await assertTimelineAccess(req, id);
    const { note } = req.body as { note?: string };
    res.status(201).json({ snapshot: await TimelineService.snapshot(req.user!, id, note) });
  },
);

/**
 * GET /api/timelines/:id/snapshots/:revision — une révision et son écart avec la
 * précédente : plans ajoutés, retirés, re-versionnés.
 */
router.get(
  '/:id/snapshots/:revision',
  validate({ params: idParam.extend({ revision: z.coerce.number().int().min(1) }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    await assertTimelineAccess(req, id);
    res.json(await TimelineService.getSnapshot(id, Number(req.params.revision)));
  },
);

/**
 * GET /api/timelines/:id/comments — les retours posés sur le montage (Phase 46), dans
 * l'ordre du film. Ils s'écrivent par `POST /api/comments` avec `timelineId`.
 */
router.get('/:id/comments', validate({ params: idParam, query: paginationQuery }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.json(await CommentService.listMontage(id, readPagination(req.query)));
});

// GET /api/timelines/:id/export — un master est-il disponible ? (URL signée si oui)
router.get('/:id/export', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.json(await TimelineService.exportState(id));
});

/**
 * POST /api/timelines/:id/export — encode le montage en un fichier unique (superviseur+).
 * La lecture enchaînée n'a rien à encoder ; ce master sert à l'envoi hors de l'application.
 */
router.post('/:id/export', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await assertTimelineAccess(req, id);
  res.status(202).json(await TimelineService.requestExport(req.user!, id));
});

export default router;
