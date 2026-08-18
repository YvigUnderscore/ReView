// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requireProjectAccess } from '../middleware/rbac';
import * as StatsService from '../services/StatsService';
import * as ScheduleService from '../services/ScheduleService';
import * as ProductionService from '../services/ProductionService';

/**
 * Production & reporting (Phase 43) — statistiques de review par projet (43.A).
 * Monté sous /api/projects ; accès borné au membership (requireProjectAccess).
 */
const router = Router();
router.use(authenticate);

const projectIdParam = z.object({ projectId: z.coerce.number().int() });

// GET /api/projects/:projectId/stats — temps par shot, notes/retakes, convergence par séquence
router.get(
  '/:projectId/stats',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    res.json(await StatsService.getProjectStats(Number(req.params.projectId)));
  },
);

/**
 * GET /api/projects/:projectId/production?weeks= — pilotage (C6).
 *
 * Quatre réponses en un appel : où en est le projet, ce qui bloque, qui fait quoi, à
 * quel rythme. La fenêtre de rythme est réglable — huit semaines par défaut.
 */
router.get(
  '/:projectId/production',
  validate({
    params: projectIdParam,
    query: z.object({ weeks: z.coerce.number().int().min(2).max(52).optional() }),
  }),
  requireProjectAccess,
  async (req, res) => {
    const weeks = req.query.weeks ? Number(req.query.weeks) : undefined;
    res.json(await ProductionService.getOverview(Number(req.params.projectId), weeks));
  },
);

// GET /api/projects/:projectId/schedule — tâches datées (calendrier + Gantt, lecture seule)
router.get(
  '/:projectId/schedule',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    res.json(await ScheduleService.getProjectSchedule(Number(req.params.projectId)));
  },
);

export default router;
