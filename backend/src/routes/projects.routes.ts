// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, ProjectStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, requireProjectAccess, requireProjectManage } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { effectiveProjectRole } from '../lib/projectRoles';
import { paginationQuery, readPagination } from '../lib/pagination';
import { projectSettingsSchema } from '../lib/projectSettings';
import * as ProjectService from '../services/ProjectService';

const router = Router();
router.use(authenticate);

const projectIdParam = z.object({ projectId: z.coerce.number().int() });

// GET /api/projects — admin and supervisor: everything; otherwise: the projects the user is a member of.
// Paginated: { items, total, page, pageSize } (10.D1). `archived=1` → Archived tab (38.B).
router.get(
  '/',
  validate({ query: paginationQuery.extend({ archived: z.enum(['0', '1']).optional() }) }),
  async (req, res) => {
    const onlyArchived = req.query.archived === '1';
    res.json(await ProjectService.listProjects(req.user!, readPagination(req.query), onlyArchived));
  },
);

// POST /api/projects (admin and supervisor)
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

// GET /api/projects/:projectId — includes `myRole` (the caller's effective role, 38.E)
router.get('/:projectId', validate({ params: projectIdParam }), requireProjectAccess, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const [project, myRole] = await Promise.all([
    ProjectService.getProject(projectId),
    effectiveProjectRole(req.user!.id, req.user!.role, projectId),
  ]);
  res.json({ project: { ...project, myRole } });
});

// PATCH /api/projects/:projectId (admin and supervisor)
router.patch(
  '/:projectId',
  validate({
    params: projectIdParam,
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      description: z.string().max(2000).nullable().optional(),
      status: z.nativeEnum(ProjectStatus).optional(),
      // No `thumbnailKey` here: nothing has ever been able to produce a project thumbnail key (the dedicated
      // router only covers sequence, shot and asset), and a key received from the client let anyone presign
      // any object in the bucket. The project falls back to the thumbnail of its first published media, as
      // it always has.
      startFrame: z.number().int().optional(),
      // Storage quota in bytes (38.D): null means unlimited.
      storageQuota: z.number().int().min(0).nullable().optional(),
    }),
  }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    res.json({ project: await ProjectService.updateProject(Number(req.params.projectId), req.body) });
  },
);

// DELETE /api/projects/:projectId — soft delete (admin and supervisor)
router.delete(
  '/:projectId',
  validate({ params: projectIdParam }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    await ProjectService.softDelete(req.user!, Number(req.params.projectId));
    res.status(204).end();
  },
);

// GET /api/projects/:projectId/trash — the project's deleted items (admin and supervisor)
router.get(
  '/:projectId/trash',
  validate({ params: projectIdParam }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    res.json(await ProjectService.getTrash(Number(req.params.projectId)));
  },
);

// POST /api/projects/:projectId/restore (admin and supervisor)
router.post(
  '/:projectId/restore',
  validate({ params: projectIdParam }),
  requireRole(Role.ADMIN, Role.SUPERVISOR),
  async (req, res) => {
    await ProjectService.restore(req.user!, Number(req.params.projectId));
    res.status(204).end();
  },
);

// DELETE /api/projects/:projectId/purge — permanent deletion from DB + MinIO (admin)
router.delete(
  '/:projectId/purge',
  validate({ params: projectIdParam }),
  requireRole(Role.ADMIN),
  async (req, res) => {
    await ProjectService.purge(req.user!, Number(req.params.projectId));
    res.status(204).end();
  },
);

// POST /api/projects/:projectId/members (admin and supervisor)
router.post(
  '/:projectId/members',
  validate({
    params: projectIdParam,
    body: z.object({ userId: z.number().int(), role: z.nativeEnum(Role).optional() }),
  }),
  requireProjectManage, // 38.E: local supervisor allowed
  async (req, res) => {
    const { userId, role } = req.body as { userId: number; role?: Role };
    const actor = req.user!;
    const membership = await ProjectService.addMember(Number(req.params.projectId), userId, role, actor);
    res.status(201).json({ membership });
  },
);

// GET /api/projects/:projectId/settings — EFFECTIVE settings (studio inheritance applied)
// + `overrides`: the sections the project actually overrides.
router.get(
  '/:projectId/settings',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    res.json(await ProjectService.getSettings(Number(req.params.projectId)));
  },
);

// PUT /api/projects/:projectId/settings — replaces the WHOLE override (admin and supervisor).
// Sections absent from the body return to studio inheritance; to touch only one, prefer the PATCH
// (projects-extra.routes).
router.put(
  '/:projectId/settings',
  validate({ params: projectIdParam, body: projectSettingsSchema }),
  requireProjectManage, // 38.E: local supervisor allowed
  async (req, res) => {
    res.json(
      await ProjectService.updateSettings(req.user!, Number(req.params.projectId), req.body as object),
    );
  },
);

// GET /api/projects/:projectId/activity — activity feed (uploads, versions) + tasks
router.get(
  '/:projectId/activity',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    res.json(await ProjectService.getActivity(Number(req.params.projectId)));
  },
);

// DELETE /api/projects/:projectId/members/:userId (admin and supervisor)
router.delete(
  '/:projectId/members/:userId',
  validate({ params: z.object({ projectId: z.coerce.number().int(), userId: z.coerce.number().int() }) }),
  requireProjectManage, // 38.E: local supervisor allowed
  async (req, res) => {
    await ProjectService.removeMember(Number(req.params.projectId), Number(req.params.userId), req.user);
    res.status(204).end();
  },
);

export default router;
