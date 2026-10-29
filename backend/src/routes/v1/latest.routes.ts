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
 * "Give me the latest version": the read gesture of an artist workstation.
 *
 * Two entries, depending on what the tool knows: a task identifier (read from the API) or a
 * pipeline path (it only knows names, e.g. a Nuke launched by the render farm). The logic is the
 * same; see `latestPick`.
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
 * GET /api/v1/latest?path=PROJ/SQ010/SH0100: same response, addressed by path.
 *
 * The path may stop at the shot or the asset: the election then picks the most advanced step of
 * the pipe, which is what a reviewer should see when opening the shot. It may also name a task to
 * stay on one step, or a version to read it as-is.
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
 * Entity the election applies to. A path that already names a version has nothing to elect: we
 * say so rather than returning a neighbouring version at random. Same refusal as
 * `POST /api/v1/publish`, so both surfaces behave alike.
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
