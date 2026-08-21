// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, AssetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole, assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForAsset } from '../lib/pipeline';
import { softDeleteAsset, restoreAsset, purgeAsset } from '../lib/trash';
import {
  firstMediaThumbKeyForAsset,
  firstMediaThumbKeysForAssets,
  effectiveThumbnailUrl,
} from '../lib/thumbnails';
import { mountTrashRoutes } from './trashRoutes';
import { notFound } from '../lib/errors';
import { paginationQuery, readPagination, pageArgs, paginate } from '../lib/pagination';
import * as PipelineLatestService from '../services/PipelineLatestService';
import * as AssetService from '../services/AssetService';
import { assertLocalCreationAllowed } from '../services/shotgrid/ShotgridGuardService';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int() });

// GET /api/assets?projectId=X — paginé (10.D1)
router.get(
  '/',
  validate({ query: z.object({ projectId: z.coerce.number().int() }).merge(paginationQuery) }),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    await assertProjectAccess(req, projectId);
    const p = readPagination(req.query);
    const where = { projectId, deletedAt: null };
    const [assets, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(p),
        include: {
          _count: { select: { versions: true, tasks: true } },
          // Étapes et assignés : le menu contextuel des cartes en a besoin pour cocher
          // l'état courant. Sans eux, il faudrait une requête par carte affichée.
          departments: {
            select: { id: true, key: true, name: true, color: true },
            orderBy: { order: 'asc' },
          },
          tasks: {
            select: {
              id: true,
              departmentId: true,
              // Le nom de l'étape vient d'ici : une tâche peut vivre dans un département
              // que l'asset ne déclare pas, et le menu doit tout de même savoir le nommer.
              departmentRef: { select: { id: true, name: true } },
              assignee: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.asset.count({ where }),
    ]);
    // Requête groupée (B3) — cf. ShotService.list.
    const fallbacks = await firstMediaThumbKeysForAssets(assets.map((a) => a.id));
    const items = await Promise.all(
      assets.map(async (a) => ({
        ...a,
        thumbnailUrl: await effectiveThumbnailUrl(a.thumbnailKey, fallbacks.get(a.id) ?? null),
      })),
    );
    res.json(paginate(items, total, p));
  },
);

// POST /api/assets (admin/superviseur)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      projectId: z.number().int(),
      name: z.string().min(1).max(160),
      type: z.nativeEnum(AssetType).default(AssetType.OTHER),
      description: z.string().max(2000).optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as AssetService.CreateAssetInput;
    await assertProjectAccess(req, body.projectId);
    await assertLocalCreationAllowed(body.projectId, 'asset'); // 48 : ShotGrid mène
    res.status(201).json({ asset: await AssetService.create(body) });
  },
);

// GET /api/assets/:id
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { createdAt: 'desc' } },
      tasks: {
        orderBy: { order: 'asc' },
        include: { assignee: { select: { id: true, name: true } } },
      },
      shots: { where: { deletedAt: null }, select: { id: true, code: true, name: true, sequenceId: true } },
      sequences: { where: { deletedAt: null }, select: { id: true, code: true, name: true } },
      // Départements traversés (B1) : le panneau de réglages les coche (C3).
      departments: { select: { id: true, key: true, name: true, color: true }, orderBy: { order: 'asc' } },
    },
  });
  if (!asset) throw notFound('Asset not found');
  await assertProjectAccess(req, asset.projectId);
  // La vignette n'était calculée que dans la liste : la page d'un asset ne montrait
  // jamais l'image, alors que celle d'un plan l'affichait.
  const thumbnailUrl = await effectiveThumbnailUrl(asset.thumbnailKey, await firstMediaThumbKeyForAsset(id));
  res.json({ asset: { ...asset, thumbnailUrl } });
});

// PATCH /api/assets/:id (admin/superviseur)
router.patch(
  '/:id',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    params: idParam,
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      type: z.nativeEnum(AssetType).optional(),
      // C3 : le libellé de type n'était écrit que par la synchronisation ShotGrid.
      typeLabel: z.string().max(120).nullable().optional(),
      description: z.string().max(2000).nullable().optional(),
      // Pas de `thumbnailKey` ici : la clé est écrite par `PUT /api/assets/:id/thumbnail`,
      // qui la reconstruit et vérifie qu'elle désigne bien CET asset. Reçue du client, elle
      // faisait présigner n'importe quel objet du bucket — pièce jointe d'autrui comprise.
      shotIds: z.array(z.number().int()).optional(),
      sequenceIds: z.array(z.number().int()).optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForAsset(id);
    if (!projectId) throw notFound('Asset not found');
    await assertProjectAccess(req, projectId);
    const asset = await AssetService.update(projectId, id, req.body as AssetService.UpdateAssetInput);
    res.json({ asset });
  },
);

/**
 * GET /api/assets/:id/tree — l'asset vu comme un dossier (Phase 45).
 *
 * Départements dans l'ordre du pipe → tâches → versions → médias, plus la version qui
 * fait foi. Jusqu'ici la page d'un asset n'affichait que les versions rattachées
 * DIRECTEMENT à l'asset : tout ce qu'un DCC publie sous une tâche était invisible.
 */
router.get('/:id/tree', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveProjectIdForAsset(id);
  if (!projectId) throw notFound('Asset not found');
  await assertProjectAccess(req, projectId);
  res.json(await PipelineLatestService.assetOverview(id, req.user!.id));
});

/**
 * GET /api/assets/:id/latest — l'équivalent d'une « master version » : une adresse stable
 * qui désigne toujours l'état le plus avancé de l'asset. Un lien collé dans une note de
 * production reste juste trois mois plus tard, sans que personne le remette à jour.
 */
router.get('/:id/latest', validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  const projectId = await resolveProjectIdForAsset(id);
  if (!projectId) throw notFound('Asset not found');
  await assertProjectAccess(req, projectId);
  const { latest } = await PipelineLatestService.assetOverview(id, req.user!.id);
  if (!latest) throw notFound('No published version for this asset', 'NO_PUBLISHED_VERSION');
  res.json({ latest });
});

// Corbeille : mise à la corbeille, restauration, purge — montage partagé (C3).
mountTrashRoutes(router, {
  entityType: 'Asset',
  auditPrefix: 'ASSET',
  notFoundMessage: 'Asset not found',
  resolveProjectId: resolveProjectIdForAsset,
  softDelete: (_userId, id) => softDeleteAsset(id),
  restore: restoreAsset,
  purge: (_userId, id) => purgeAsset(id),
});

export default router;
