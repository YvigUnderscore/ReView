// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request } from 'express';
import { z } from 'zod';
import { Role, AssetType } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForShot } from '../lib/pipeline';
import { pipelineOverrideSchema } from '../lib/projectSettings';
import { notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as ShotService from '../services/ShotService';
import * as PipelineLatestService from '../services/PipelineLatestService';
import { assertLocalCreationAllowed } from '../services/shotgrid/ShotgridGuardService';
import { softDeleteShot, restoreShot, purgeShot } from '../lib/trash';
import { mountTrashRoutes } from './trashRoutes';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

// Champs d'un shot (création). PATCH les rend optionnels via `.partial()`.
const shotBody = z.object({
  sequenceId: z.number().int().nullable().optional(),
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(60),
  startFrame: z.number().int().nullable().optional(),
  endFrame: z.number().int().nullable().optional(),
  order: z.number().int().optional(),
  settings: pipelineOverrideSchema.optional(),
});

/** Résout le projet d'un shot + assertion d'accès (RBAC dynamique) → renvoie le projectId. */
async function resolveShotAccess(req: Request, shotId: number): Promise<number> {
  const projectId = await resolveProjectIdForShot(shotId);
  if (!projectId) throw notFound('Shot not found');
  await assertProjectAccess(req, projectId);
  return projectId;
}

// GET /api/shots?projectId=X[&sequenceId=Y|none] — « none » = shots hors séquence. Paginé (10.D1).
router.get(
  '/',
  validate({
    query: z
      .object({
        projectId: z.coerce.number().int(),
        sequenceId: z.union([z.coerce.number().int(), z.literal('none')]).optional(),
      })
      .merge(paginationQuery),
  }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const seq = req.query.sequenceId as unknown as number | 'none' | undefined;
    res.json(await ShotService.list(projectId, seq, readPagination(req.query)));
  },
);

// POST /api/shots (admin/superviseur)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ body: shotBody.extend({ projectId: z.number().int() }) }),
  async (req, res) => {
    await assertProjectAccess(req, req.body.projectId);
    await assertLocalCreationAllowed(req.body.projectId, 'shot'); // 48 : ShotGrid mène
    res.status(201).json({ shot: await ShotService.create(req.body) });
  },
);

// POST /api/shots/bulk — création en lot (admin/superviseur)
router.post(
  '/bulk',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({ projectId: z.number().int(), items: z.array(shotBody).min(1).max(200) }),
  }),
  async (req, res) => {
    const { projectId, items } = req.body as { projectId: number; items: ShotService.BulkShotItem[] };
    await assertProjectAccess(req, projectId);
    await assertLocalCreationAllowed(projectId, 'shot'); // 48 : ShotGrid mène
    res.status(201).json({ shots: await ShotService.createBulk(projectId, items) });
  },
);

// GET /api/shots/:id
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const shot = await ShotService.get(Number(req.params.id));
  await assertProjectAccess(req, shot.projectId);
  res.json({ shot });
});

// PATCH /api/shots/:id (admin/superviseur)
router.patch(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: idParam,
    body: shotBody.partial().extend({
      description: z.string().max(2000).nullable().optional(),
      // Pas de `thumbnailKey` ici : la clé est écrite par `PUT /api/shots/:id/thumbnail`,
      // qui la reconstruit et vérifie qu'elle désigne bien CE plan. Reçue du client, elle
      // faisait présigner n'importe quel objet du bucket — pièce jointe d'autrui comprise.
      // Statut du plan (C3) : la colonne existait, le PATCH ne l'acceptait pas.
      pipelineStatusId: z.number().int().nullable().optional(),
      // Omis du montage (Phase 45) : le plan est coupé au montage sans rien perdre.
      omitted: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveShotAccess(req, id);
    res.json({ shot: await ShotService.update(id, projectId, req.body, req.user!.id) });
  },
);

// POST /api/shots/:id/assets — rattache un asset existant OU en crée un et le rattache.
router.post(
  '/:id/assets',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: idParam,
    body: z
      .object({
        assetId: z.number().int().optional(),
        name: z.string().min(1).max(160).optional(),
        type: z.nativeEnum(AssetType).optional(),
      })
      .refine(
        (b) => b.assetId !== undefined || (b.name && b.name.trim().length > 0),
        'assetId ou name requis',
      ),
  }),
  async (req, res) => {
    const shotId = Number(req.params.id);
    const projectId = await resolveShotAccess(req, shotId);
    res.status(201).json({ asset: await ShotService.attachAsset(shotId, projectId, req.body) });
  },
);

// DELETE /api/shots/:id/assets/:assetId — détache un asset d'un shot (sans le supprimer)
router.delete(
  '/:id/assets/:assetId',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({ params: z.object({ id: z.coerce.number().int(), assetId: z.coerce.number().int() }) }),
  async (req, res) => {
    const shotId = Number(req.params.id);
    await resolveShotAccess(req, shotId);
    await ShotService.detachAsset(shotId, Number(req.params.assetId));
    res.status(204).end();
  },
);

// Corbeille : mise à la corbeille, restauration, purge — montage partagé (C3).
mountTrashRoutes(router, {
  entityType: 'Shot',
  auditPrefix: 'SHOT',
  notFoundMessage: 'Shot not found',
  resolveProjectId: resolveProjectIdForShot,
  softDelete: (_userId, id) => softDeleteShot(id),
  restore: restoreShot,
  purge: (_userId, id) => purgeShot(id),
});

// GET /api/shots/:id/tree — le plan vu comme un dossier, comme un asset (cf. shotOverview).
router.get('/:id/tree', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveProjectIdForShot(id);
  if (!projectId) throw notFound('Shot not found');
  await assertProjectAccess(req, projectId);
  res.json(await PipelineLatestService.shotOverview(id, req.user!.id));
});

/**
 * GET /api/shots/:id/latest — permalien du plan, pendant de celui d'un asset (C3).
 *
 * Il manquait, et la page d'un plan proposait quand même « copier le lien » : le bouton
 * copiait `/assets/<id>/latest`, c'est-à-dire l'adresse d'une entité sans rapport, que le
 * destinataire ouvrait sans se douter de rien.
 */
router.get('/:id/latest', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await resolveShotAccess(req, id);
  const { latest } = await PipelineLatestService.shotOverview(id, req.user!.id);
  if (!latest) throw notFound('No published version for this shot', 'NO_PUBLISHED_VERSION');
  res.json({ latest });
});

export default router;
