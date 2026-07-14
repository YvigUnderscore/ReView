import { Router } from 'express';
import { z } from 'zod';
import { Role, ProjectStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, requireProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { paginationQuery, readPagination } from '../lib/pagination';
import { projectSettingsSchema } from '../lib/projectSettings';
import * as ProjectService from '../services/ProjectService';

const router = Router();
router.use(authenticate);

const projectIdParam = z.object({ projectId: z.coerce.number().int() });

// GET /api/projects — admin/superviseur : tout ; sinon : projets dont l'user est membre.
// Paginé : { items, total, page, pageSize } (10.D1).
router.get('/', validate({ query: paginationQuery }), async (req, res) => {
  res.json(await ProjectService.listProjects(req.user!, readPagination(req.query)));
});

// POST /api/projects (admin/superviseur)
router.post(
  '/',
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  validate({
    body: z.object({
      name: z.string().min(1).max(160),
      description: z.string().max(2000).optional(),
      startFrame: z.number().int().optional(),
    }),
  }),
  async (req, res) => {
    res.status(201).json({ project: await ProjectService.createProject(req.user!, req.body) });
  },
);

// GET /api/projects/:projectId
router.get('/:projectId', validate({ params: projectIdParam }), requireProjectAccess, async (req, res) => {
  res.json({ project: await ProjectService.getProject(Number(req.params.projectId)) });
});

// PATCH /api/projects/:projectId (admin/superviseur)
router.patch(
  '/:projectId',
  validate({
    params: projectIdParam,
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      description: z.string().max(2000).nullable().optional(),
      status: z.nativeEnum(ProjectStatus).optional(),
      thumbnailKey: z.string().max(512).nullable().optional(),
      startFrame: z.number().int().optional(),
    }),
  }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    res.json({ project: await ProjectService.updateProject(Number(req.params.projectId), req.body) });
  },
);

// DELETE /api/projects/:projectId — soft delete (admin/superviseur)
router.delete(
  '/:projectId',
  validate({ params: projectIdParam }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    await ProjectService.softDelete(req.user!, Number(req.params.projectId));
    res.status(204).end();
  },
);

// GET /api/projects/:projectId/trash — éléments supprimés du projet (admin/superviseur)
router.get(
  '/:projectId/trash',
  validate({ params: projectIdParam }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    res.json(await ProjectService.getTrash(Number(req.params.projectId)));
  },
);

// POST /api/projects/:projectId/restore (admin/superviseur)
router.post(
  '/:projectId/restore',
  validate({ params: projectIdParam }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    await ProjectService.restore(req.user!, Number(req.params.projectId));
    res.status(204).end();
  },
);

// DELETE /api/projects/:projectId/purge — suppression définitive DB + MinIO (admin)
router.delete(
  '/:projectId/purge',
  validate({ params: projectIdParam }),
  requireRole(Role.ADMIN),
  async (req, res) => {
    await ProjectService.purge(req.user!, Number(req.params.projectId));
    res.status(204).end();
  },
);

// POST /api/projects/:projectId/members (admin/superviseur)
router.post(
  '/:projectId/members',
  validate({
    params: projectIdParam,
    body: z.object({ userId: z.number().int(), role: z.nativeEnum(Role).optional() }),
  }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const { userId, role } = req.body as { userId: number; role?: Role };
    const membership = await ProjectService.addMember(Number(req.params.projectId), userId, role);
    res.status(201).json({ membership });
  },
);

// GET /api/projects/:projectId/settings — réglages effectifs (départements, nomenclature)
router.get(
  '/:projectId/settings',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    res.json({ settings: await ProjectService.getSettings(Number(req.params.projectId)) });
  },
);

// PUT /api/projects/:projectId/settings — override des réglages projet (admin/superviseur)
router.put(
  '/:projectId/settings',
  validate({ params: projectIdParam, body: projectSettingsSchema }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    const settings = await ProjectService.updateSettings(
      req.user!,
      Number(req.params.projectId),
      req.body as object,
    );
    res.json({ settings });
  },
);

// GET /api/projects/:projectId/activity — flux d'activité (uploads, versions) + tâches
router.get(
  '/:projectId/activity',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    res.json(await ProjectService.getActivity(Number(req.params.projectId)));
  },
);

// DELETE /api/projects/:projectId/members/:userId (admin/superviseur)
router.delete(
  '/:projectId/members/:userId',
  validate({ params: z.object({ projectId: z.coerce.number().int(), userId: z.coerce.number().int() }) }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    await ProjectService.removeMember(Number(req.params.projectId), Number(req.params.userId));
    res.status(204).end();
  },
);

export default router;
