import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, requireProjectAccess } from '../middleware/rbac';
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

export default router;
