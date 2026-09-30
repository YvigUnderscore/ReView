// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { notFound } from '../lib/errors';
import { resolveProjectIdForEpisode } from '../lib/pipeline';
import { assertProjectWritable } from '../lib/projectGuard';
import { readPagination, paginationQuery } from '../lib/pagination';
import { softDeleteEpisode, restoreEpisode, purgeEpisode } from '../lib/trash';
import { logAudit } from '../services/AuditService';
import { mountTrashRoutes } from './trashRoutes';
import * as EpisodeService from '../services/EpisodeService';
import * as PipelineStatusService from '../services/PipelineStatusService';
import { assertEpisodeCreationAllowed } from '../services/shotgrid/ShotgridEpisodes';

/**
 * Le niveau Épisode (série) — routes.
 *
 * Deux familles : l'interrupteur du projet (`/settings`), lisible et modifiable même
 * quand le niveau est éteint, et les épisodes eux-mêmes, qui répondent 409 tant qu'il
 * l'est. Le service porte la règle ; la route se contente de valider et d'autoriser.
 *
 * `/settings` est déclaré AVANT `/:id` : Express 5 essaie les routes dans l'ordre, et
 * `/:id` capturerait « settings » avant de le refuser en validation.
 */
const router = Router();
router.use(authenticate);

const manage = requireRole(Role.ADMIN, Role.SUPERVISOR);
const idParam = z.object({ id: z.coerce.number().int() });
const projectQuery = z.object({ projectId: z.coerce.number().int() });
const episodeBody = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(60),
  order: z.number().int().optional(),
});

/** Projet propriétaire de l'épisode, accès vérifié. Lève 404 si l'épisode n'existe pas. */
async function projectOf(req: Parameters<typeof assertProjectAccess>[0], id: number): Promise<number> {
  const projectId = await resolveProjectIdForEpisode(id);
  if (!projectId) throw notFound('Episode not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

// ── L'interrupteur ────────────────────────────────────────────────────────────
// GET reste ouvert à tout membre : c'est lui qui dit aux écrans s'ils doivent montrer
// le niveau, et un artiste doit voir la même hiérarchie que son superviseur.
router.get('/settings', validate({ query: projectQuery }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  res.json({ settings: await EpisodeService.readSettings(projectId) });
});

// Désactiver ne détruit rien (cf. EpisodeService) : les épisodes et leurs rattachements
// survivent et réapparaissent intacts à la réactivation.
router.put(
  '/settings',
  manage,
  validate({ body: z.object({ projectId: z.number().int(), enabled: z.boolean() }) }),
  async (req, res) => {
    const { projectId, enabled } = req.body as { projectId: number; enabled: boolean };
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId);
    const settings = await EpisodeService.setEnabled(projectId, enabled);
    logAudit({
      userId: req.user!.id,
      action: enabled ? 'EPISODES_ENABLE' : 'EPISODES_DISABLE',
      entityType: 'Project',
      entityId: projectId,
    });
    res.json({ settings });
  },
);

// ── Les épisodes ──────────────────────────────────────────────────────────────
router.get('/', validate({ query: projectQuery.merge(paginationQuery) }), async (req, res) => {
  const projectId = Number(req.query.projectId);
  await assertProjectAccess(req, projectId);
  await EpisodeService.assertEnabled(projectId);
  res.json(await EpisodeService.list(projectId, readPagination(req.query)));
});

router.post(
  '/',
  manage,
  validate({ body: episodeBody.extend({ projectId: z.number().int() }) }),
  async (req, res) => {
    const { projectId, ...input } = req.body as EpisodeService.EpisodeInput & { projectId: number };
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId);
    await assertEpisodeCreationAllowed(projectId); // ShotGrid mène : on ne crée pas d'orphelin
    res.status(201).json({ episode: await EpisodeService.create(projectId, input) });
  },
);

router.post(
  '/bulk',
  manage,
  validate({
    body: z.object({ projectId: z.number().int(), items: z.array(episodeBody).min(1).max(200) }),
  }),
  async (req, res) => {
    const { projectId, items } = req.body as { projectId: number; items: EpisodeService.EpisodeInput[] };
    await assertProjectAccess(req, projectId);
    await assertProjectWritable(projectId);
    await assertEpisodeCreationAllowed(projectId);
    res.status(201).json({ episodes: await EpisodeService.createBulk(projectId, items) });
  },
);

const reorderBody = z.object({
  projectId: z.number().int(),
  ids: z.array(z.number().int()).min(1).max(500),
});
router.post('/reorder', manage, validate({ body: reorderBody }), async (req, res) => {
  const { projectId, ids } = req.body as z.infer<typeof reorderBody>;
  await assertProjectAccess(req, projectId);
  await assertProjectWritable(projectId);
  await EpisodeService.reorder(projectId, ids);
  res.status(204).end();
});

/** Rattache des séquences à un épisode — `episodeId: null` les en détache. */
const assignBody = z.object({
  projectId: z.number().int(),
  episodeId: z.number().int().nullable(),
  sequenceIds: z.array(z.number().int()).min(1).max(500),
});
router.post('/assign', manage, validate({ body: assignBody }), async (req, res) => {
  const { projectId, episodeId, sequenceIds } = req.body as z.infer<typeof assignBody>;
  await assertProjectAccess(req, projectId);
  await assertProjectWritable(projectId);
  res.json({ count: await EpisodeService.assignSequences(projectId, episodeId, sequenceIds) });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await projectOf(req, id);
  await EpisodeService.assertEnabled(projectId);
  res.json({ episode: await EpisodeService.getDetail(id) });
});

router.patch(
  '/:id',
  manage,
  validate({
    params: idParam,
    body: episodeBody.partial().extend({
      description: z.string().max(2000).nullable().optional(),
      pipelineStatusId: z.number().int().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await projectOf(req, id);
    await assertProjectWritable(projectId);
    const body = req.body as EpisodeService.UpdateEpisodeInput;
    // Même garde que pour une séquence : le statut doit venir du vocabulaire de CE
    // projet. L'épisode partage le périmètre « sequence » (cf. schema.prisma).
    if (body.pipelineStatusId !== undefined) {
      await PipelineStatusService.assertBelongsToProject(projectId, 'sequence', body.pipelineStatusId);
    }
    res.json({ episode: await EpisodeService.update(id, projectId, body) });
  },
);

// ── Corbeille ─────────────────────────────────────────────────────────────────
// Montage partagé, comme séquences/plans/assets : la corbeille du projet et la
// sélection multiple y accèdent par les mêmes chemins.
mountTrashRoutes(router, {
  entityType: 'Episode',
  auditPrefix: 'EPISODE',
  notFoundMessage: 'Episode not found',
  resolveProjectId: resolveProjectIdForEpisode,
  softDelete: (_userId, id) => softDeleteEpisode(id),
  restore: restoreEpisode,
  purge: (_userId, id) => purgeEpisode(id),
});

export default router;
