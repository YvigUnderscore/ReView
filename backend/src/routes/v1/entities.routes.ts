// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { validate } from '../../middleware/validate';
import { requireScope } from '../../middleware/scope';
import { notFound } from '../../lib/errors';
import { shotSelect, assetSelect, toShot, toAsset } from '../../lib/v1Resources';
import { idParam, requireShotProject, requireAssetProject } from './helpers';

/**
 * Entités du pipeline adressées par identifiant (API v1) : shots et assets. Ces routes
 * prolongent celles du projet — un client qui a résolu un chemin repart d'ici sans
 * repasser par la hiérarchie. Leurs tâches et leurs versions ont leurs propres fichiers
 * (`tasks.routes`, `versions.routes`).
 */
const router = Router();

router.get('/shots/:id', requireScope('shots:read'), validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await requireShotProject(req, id);
  const shot = await prisma.shot.findUnique({ where: { id }, select: shotSelect });
  if (!shot) throw notFound('Shot not found');
  res.json({ shot: toShot(shot) });
});

router.get('/assets/:id', requireScope('assets:read'), validate({ params: idParam }), async (req, res) => {
  const id = Number(req.params.id);
  await requireAssetProject(req, id);
  const asset = await prisma.asset.findUnique({ where: { id }, select: assetSelect });
  if (!asset) throw notFound('Asset not found');
  res.json({ asset: toAsset(asset) });
});

export default router;
