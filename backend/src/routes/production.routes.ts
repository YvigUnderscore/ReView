// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requireProjectManage } from '../middleware/rbac';
import * as StatsService from '../services/StatsService';
import * as ScheduleService from '../services/ScheduleService';
import * as ProductionService from '../services/ProductionService';
import * as GridService from '../services/GridService';

/**
 * Production and reporting (Phase 43, extended in Phase 50): production tracking per project.
 *
 * Mounted under /api/projects.
 *
 * **All these reads are reserved to whoever MANAGES the project** (`requireProjectManage`, so CLIENT is
 * excluded). They were open to any member: the tab exposed the NAMED workload of each artist, their
 * delays and the tasks nobody had taken, internal information that a guest client on a project has no
 * reason to read, and that they could obtain by calling the API directly.
 */
const router = Router();
router.use(authenticate);

const projectIdParam = z.object({ projectId: z.coerce.number().int() });

// GET /api/projects/:projectId/stats — time per shot, notes and retakes, convergence per sequence
router.get(
  '/:projectId/stats',
  validate({ params: projectIdParam }),
  requireProjectManage,
  async (req, res) => {
    res.json(await StatsService.getProjectStats(Number(req.params.projectId)));
  },
);

/**
 * GET /api/projects/:projectId/production?weeks=: steering (C6).
 *
 * Four answers in one call: where the project stands, what is blocking it, who does what, and at what
 * pace. The pace window is adjustable: eight weeks by default.
 */
router.get(
  '/:projectId/production',
  validate({
    params: projectIdParam,
    query: z.object({ weeks: z.coerce.number().int().min(2).max(52).optional() }),
  }),
  requireProjectManage,
  async (req, res) => {
    const weeks = req.query.weeks ? Number(req.query.weeks) : undefined;
    res.json(await ProductionService.getOverview(Number(req.params.projectId), weeks));
  },
);

/**
 * GET /api/projects/:projectId/schedule?from=&to=: dated tasks (calendar and Gantt).
 *
 * The window bounds the read: a Gantt only ever shows a month or a quarter, and without it the route
 * fetched the whole dated project. Both bounds remain optional: when absent, the answer is the previous
 * one, up to the safety ceiling, which it then announces through `truncated`.
 */
const scheduleQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/:projectId/schedule',
  validate({ params: projectIdParam, query: scheduleQuery }),
  requireProjectManage,
  async (req, res) => {
    // `validate` has already converted the bounds; we re-read through the same schema to type them.
    const { from, to } = scheduleQuery.parse(req.query);
    res.json(await ScheduleService.getProjectSchedule(Number(req.params.projectId), { from, to }));
  },
);

/**
 * GET /api/projects/:projectId/grid: tracking grid (shots × departments).
 *
 * **Pagination is PER SHOT.** A row is a shot with all its cells: a cursor that counted tasks would cut
 * a row in two. `cursor` always comes from the `nextCursor` of the previous answer; the five filters are
 * optional and cumulative.
 */
const gridQuery = z.object({
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(GridService.GRID_MAX_LIMIT).optional(),
  episodeId: z.coerce.number().int().positive().optional(),
  sequenceId: z.coerce.number().int().positive().optional(),
  /** KEY of the department (`comp`), not its label: it is the key carried by the tasks. */
  department: z.string().min(1).max(100).optional(),
  assigneeId: z.coerce.number().int().positive().optional(),
  /** Studio status code, or value of the frozen enum in the absence of a catalog. */
  status: z.string().min(1).max(60).optional(),
});

router.get(
  '/:projectId/grid',
  validate({ params: projectIdParam, query: gridQuery }),
  requireProjectManage,
  async (req, res) => {
    // In Express 5, `req.query` is a getter: the middleware's coercion does not persist.
    // We re-read through the same schema to obtain numbers, as for the schedule.
    res.json(await GridService.getProjectGrid(Number(req.params.projectId), gridQuery.parse(req.query)));
  },
);

export default router;
