// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { requireScope, assertTokenProject } from '../../middleware/scope';
import { assertProjectAccess } from '../../middleware/rbac';
import { badRequest } from '../../lib/errors';
import * as Resolve from '../../services/PipelineResolveService';
import { idParam, requireTaskProject } from './helpers';
import { latestQuery, latestOptions, respondLatest, type LatestTarget } from './latestPick';

/**
 * « Donne-moi la dernière version » — le geste de lecture d'un poste d'artiste.
 *
 * Deux entrées, selon ce que l'outil connaît : l'identifiant d'une tâche (il vient de la
 * lire dans l'API) ou un chemin de pipeline (il ne connaît que des noms, cas d'un Nuke
 * lancé par la ferme). Le fond est le même — voir `latestPick`.
 */
const router = Router();

// GET /api/v1/tasks/:id/versions/latest
router.get(
  '/tasks/:id/versions/latest',
  requireScope('versions:read'),
  validate({ params: idParam, query: latestQuery }),
  async (req, res) => {
    const taskId = Number(req.params.id);
    const projectId = await requireTaskProject(req, taskId);
    res.json(await respondLatest({ taskId }, latestOptions(req, projectId)));
  },
);

/**
 * GET /api/v1/latest?path=PROJ/SQ010/SH0100 — même réponse, adressée par chemin.
 *
 * Le chemin peut s'arrêter au plan ou à l'asset : l'élection choisit alors l'étape la plus
 * avancée du pipe, c'est-à-dire ce qu'un lecteur doit voir en ouvrant le plan. Il peut
 * aussi nommer une tâche pour rester sur une étape, ou une version pour la relire telle
 * quelle.
 */
const pathQuery = latestQuery.extend({ path: z.string().min(1).max(1200) });

router.get('/latest', requireScope('versions:read'), validate({ query: pathQuery }), async (req, res) => {
  const resolved = await Resolve.resolvePath(String(req.query.path));
  await assertProjectAccess(req, resolved.projectId);
  assertTokenProject(req, resolved.projectId);

  const target = targetOf(resolved);
  res.json(await respondLatest(target, latestOptions(req, resolved.projectId)));
});

/**
 * Entité sur laquelle porte l'élection. Un chemin qui nomme déjà une version ne demande
 * rien à élire : on le dit plutôt que de rendre au hasard la version voisine — même refus
 * que `POST /api/v1/publish`, pour que les deux surfaces se comportent pareil.
 */
function targetOf(resolved: Resolve.ResolvedPath): LatestTarget {
  if (resolved.version) {
    throw badRequest(
      'The path must not include a version — read it with GET /api/v1/versions/{id}',
      'PATH_INCLUDES_VERSION',
    );
  }
  if (resolved.task) return { taskId: resolved.task.id };
  if (resolved.shot) return { shotId: resolved.shot.id };
  if (resolved.asset) return { assetId: resolved.asset.id };
  throw badRequest('The path must point to at least a shot or an asset', 'PATH_TOO_SHALLOW');
}

export default router;
