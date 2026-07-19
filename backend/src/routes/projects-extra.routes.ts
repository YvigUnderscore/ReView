import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, requireProjectAccess, requireProjectManage } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as ProjectService from '../services/ProjectService';

/**
 * Routes projet additionnelles (Phase 38) montées AVANT projects.routes pour que les chemins
 * spécifiques (`/usage`, `/:id/duplicate`, `/:id/usage`) priment sur le `GET /:projectId`
 * générique. Duplication (38.A) + usage/quotas de stockage (38.D).
 */
const router = Router();
router.use(authenticate);

const projectIdParam = z.object({ projectId: z.coerce.number().int() });

// GET /api/projects/usage — conso de stockage de tous les projets (38.D, admin/superviseur).
router.get('/usage', requireRole(Role.ADMIN, Role.SUPERVISOR), async (_req, res) => {
  res.json({ projects: await ProjectService.listUsage() });
});

// POST /api/projects/:projectId/duplicate — copie structure (+ tâches opt.), sans médias (38.A).
router.post(
  '/:projectId/duplicate',
  validate({
    params: projectIdParam,
    body: z.object({ name: z.string().min(1).max(160), includeTasks: z.boolean().optional() }),
  }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const { name, includeTasks } = req.body as { name: string; includeTasks?: boolean };
    const project = await ProjectService.duplicateProject(
      req.user!,
      Number(req.params.projectId),
      name,
      includeTasks ?? false,
    );
    res.status(201).json({ project });
  },
);

// GET /api/projects/:projectId/usage — usage/quota de stockage du projet (38.D).
router.get(
  '/:projectId/usage',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    res.json(await ProjectService.getProjectUsage(Number(req.params.projectId)));
  },
);

// POST /api/projects/:projectId/import-csv — import shots/tâches (dry-run si commit=false, 38.F).
router.post(
  '/:projectId/import-csv',
  validate({
    params: projectIdParam,
    body: z.object({ csv: z.string().min(1).max(1_000_000), commit: z.boolean().optional() }),
  }),
  requireProjectManage,
  async (req, res) => {
    const { csv, commit } = req.body as { csv: string; commit?: boolean };
    res.json(await ProjectService.importCsv(req.user!, Number(req.params.projectId), csv, commit ?? false));
  },
);

// GET /api/projects/:projectId/export-csv — export shots/tâches en CSV (38.G).
router.get(
  '/:projectId/export-csv',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    const csv = await ProjectService.exportCsv(Number(req.params.projectId));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="project-${req.params.projectId}-shots.csv"`);
    res.send(csv);
  },
);

export default router;
