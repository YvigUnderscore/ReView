// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectManager } from '../lib/shotgridAccess';
import * as Config from '../services/shotgrid/ShotgridConfigService';
import { runSync } from '../services/shotgrid/ShotgridSyncService';

/**
 * Réalignement d'une entité seule sur ShotGrid.
 *
 * La comparaison du projet dit ce qui diverge, mais tout réaligner d'un geste est une
 * décision lourde qu'on ne prend pas pour un plan. Ici on relit une entité précise :
 * ShotGrid fait foi, la valeur locale est réécrite depuis le site, et rien d'autre n'est
 * touché. C'est l'action qu'appelle la pastille posée sur un plan, un asset ou une tâche.
 */
const router = Router();
router.use(authenticate);

const LOCAL_TYPES = ['sequence', 'shot', 'asset', 'task', 'version'] as const;

router.post(
  '/projects/:projectId/realign',
  validate({
    params: z.object({ projectId: z.coerce.number().int().positive() }),
    body: z.object({
      localType: z.enum(LOCAL_TYPES),
      localId: z.number().int().positive(),
    }),
  }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    await assertProjectManager(req.user!, projectId);
    const connection = await Config.getConnection(projectId);
    if (!connection?.active) throw badRequest('Projet non relié à ShotGrid');

    const link = await prisma.shotgridLink.findFirst({
      where: {
        connectionId: connection.id,
        localType: req.body.localType,
        localId: req.body.localId,
      },
      select: { sgType: true, sgId: true },
    });
    // Une entité sans lien n'existe pas là-bas : la « réaligner » reviendrait à la créer,
    // ce que le studio a précisément choisi de faire depuis ShotGrid. On le dit plutôt
    // que d'inventer une entité distante.
    if (!link) throw notFound('Cette entité n’a pas de correspondance ShotGrid');

    const result = await runSync(projectId, {
      kind: 'incremental',
      onlySgIds: [{ sgType: link.sgType, sgId: link.sgId }],
      withMedia: req.body.localType === 'version',
      triggeredById: req.user!.id,
    });
    res.json({ status: result.status, sgType: link.sgType, sgId: link.sgId });
  },
);

export default router;
