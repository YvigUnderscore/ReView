// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as DashboardService from '../services/DashboardService';
import * as MyWorkService from '../services/MyWorkService';

const router = Router();
router.use(authenticate);

// GET /api/dashboard — data for the Home page (latest reviews, activity, my tasks, stats), bounded to
// accessible projects (membership; admin and supervisor see all).
router.get('/', async (req, res) => {
  res.json(await DashboardService.getDashboard(req.user!));
});

/**
 * GET /api/dashboard/tasks: my tasks across all projects (the "my tasks" page).
 *
 * It is the destination of the two personal cards of the Home page, which until now pointed to an
 * anchor that disappeared along with the "my tasks" block. `scope=blocked` unfolds the retake counter;
 * without a scope, it is everything assigned to me and still alive.
 *
 * `projectId` serves the same content to a project's overview: this block and this page read the same
 * scope, so they cannot contradict each other.
 */
router.get(
  '/tasks',
  validate({
    query: z
      .object({
        scope: z.enum(['all', 'blocked']).optional(),
        projectId: z.coerce.number().int().positive().optional(),
      })
      .merge(paginationQuery),
  }),
  async (req, res) => {
    const scope = req.query.scope === 'blocked' ? 'blocked' : 'all';
    // Express 5: `req.query` is a getter, the middleware's coercion does not persist on it.
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    res.json(await MyWorkService.listMyTasks(req.user!, scope, readPagination(req.query), projectId));
  },
);

/**
 * GET /api/dashboard/comments: the latest comments within my scope.
 *
 * The fourth card of the Home page counts comments: it now leads to a page that shows them. A CLIENT
 * sees only the notes addressed to them (`lib/homeScope`).
 */
router.get('/comments', validate({ query: paginationQuery }), async (req, res) => {
  res.json(await MyWorkService.listMyComments(req.user!, readPagination(req.query)));
});

export default router;
