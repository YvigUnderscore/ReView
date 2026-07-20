import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requireProjectAccess } from '../middleware/rbac';
import * as StatsService from '../services/StatsService';
import * as ScheduleService from '../services/ScheduleService';

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
