// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess, requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as DepartmentService from '../services/DepartmentService';

/**
 * Pipeline departments (B1).
 *
 * The studio catalog can be read by any authenticated account: a department serves as a label
 * everywhere (groupings, filters, badges); a project's pipe, on the other hand, is filtered by
 * membership like any project read. Administration remains with ADMIN and SUPERVISOR, like the other
 * structuring project settings.
 */
const router = Router();

/**
 * ⚠ This router is mounted on `/api` (it carries several prefixes): a `router.use(authenticate)` would
 * apply to **every** request crossing this mount point, public routes included: client sharing would
 * answer 401 instead of serving the page. Authentication is therefore set route by route.
 */
const auth = authenticate;

const manage = requireRole(Role.ADMIN, Role.SUPERVISOR);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const projectParam = z.object({ projectId: z.coerce.number().int().positive() });
const idsBody = z.object({ ids: z.array(z.number().int().positive()).max(200) });
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex color (#RRGGBB)');

const departmentBody = z.object({
  name: z.string().min(1).max(60),
  key: z.string().min(1).max(40).optional(),
  order: z.number().int().min(0).optional(),
  color: colorSchema.nullish(),
});

/**
 * Departments applicable to a project: its own, otherwise those of the studio.
 *
 * Each step carries `writable`: can the person create a task there? This is what lets the screen offer
 * two entries rather than twelve, under the department policy (cf. `lib/taskDepartmentPolicy`). The flag
 * is **advisory**: the server re-checks on write, a client does not check itself.
 *
 * Read filtered by membership (A5-06): the response is specific to the project AND to the reader, it has
 * nothing of a public catalog. The pipe of a project one is not a member of is no longer read here; the
 * studio catalog, for its part, remains open below.
 */
router.get('/projects/:projectId/departments', auth, validate({ params: projectParam }), async (req, res) => {
  const projectId = Number(req.params.projectId);
  await assertProjectAccess(req, projectId);
  res.json({ departments: await DepartmentService.listForProjectWithRights(projectId, req.user!) });
});

/** Studio catalog: the one that projects inherit by default. */
router.get('/departments', auth, async (_req, res) => {
  const project = await prisma.project.findFirst({ select: { studioId: true } });
  res.json({ departments: project ? await DepartmentService.listForStudio(project.studioId) : [] });
});

router.post(
  '/projects/:projectId/departments',
  auth,
  manage,
  validate({ params: projectParam, body: departmentBody }),
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
    if (!project) throw notFound('Project not found');
    res
      .status(201)
      .json({ department: await DepartmentService.create(project.studioId, projectId, req.body) });
  },
);

router.post('/departments', auth, manage, validate({ body: departmentBody }), async (req, res) => {
  const project = await prisma.project.findFirst({ select: { studioId: true } });
  if (!project) throw notFound('No studio yet');
  res.status(201).json({ department: await DepartmentService.create(project.studioId, null, req.body) });
});

router.patch(
  '/departments/:id',
  auth,
  manage,
  validate({ params: idParam, body: departmentBody.partial() }),
  async (req, res) => {
    res.json({ department: await DepartmentService.update(req.user!, Number(req.params.id), req.body) });
  },
);

/**
 * Image of a department: direct upload to MinIO, then recording of the key.
 *
 * Same path as an entity thumbnail: that is the only way not to route the image through the API server,
 * and the key is rebuilt server-side so that a caller cannot point a department at an arbitrary object
 * in the bucket.
 */
router.post(
  '/departments/:id/image/presign',
  auth,
  manage,
  validate({ params: idParam, body: z.object({ contentType: z.string().min(3).max(100) }) }),
  async (req, res) => {
    res.json(await DepartmentService.presignImage(Number(req.params.id), req.body.contentType));
  },
);

router.put(
  '/departments/:id/image',
  auth,
  manage,
  validate({ params: idParam, body: z.object({ key: z.string().max(300).nullable() }) }),
  async (req, res) => {
    res.json({ department: await DepartmentService.setImage(Number(req.params.id), req.body.key) });
  },
);

router.delete('/departments/:id', auth, manage, validate({ params: idParam }), async (req, res) => {
  await DepartmentService.remove(req.user!, Number(req.params.id));
  res.status(204).end();
});

router.put('/departments/order', auth, manage, validate({ body: idsBody }), async (req, res) => {
  await DepartmentService.reorder(req.user!, req.body.ids);
  res.status(204).end();
});

/**
 * Departments that an entity goes through: the template of its tasks. The list sent replaces the
 * previous one: the caller describes the desired state, not a delta.
 */
for (const [segment, holder] of [
  ['assets', 'asset'],
  ['shots', 'shot'],
  ['sequences', 'sequence'],
] as const) {
  router.put(
    `/${segment}/:id/departments`,
    auth,
    manage,
    validate({ params: idParam, body: idsBody }),
    async (req, res) => {
      await DepartmentService.setHolderDepartments(holder, Number(req.params.id), req.body.ids);
      res.status(204).end();
    },
  );

  /**
   * Ticks or unticks a department without rewriting the whole list.
   *
   * The `PUT` replaces everything: two quick clicks in a menu, and the second starts again from the list
   * before the first. The right-click toggle requires a targeted addition and removal, which cannot step
   * on each other.
   */
  router.patch(
    `/${segment}/:id/departments`,
    auth,
    manage,
    validate({
      params: idParam,
      body: z.object({
        add: z.array(z.number().int().positive()).max(50).optional(),
        remove: z.array(z.number().int().positive()).max(50).optional(),
      }),
    }),
    async (req, res) => {
      const id = Number(req.params.id);
      await DepartmentService.attachHolderDepartments(holder, id, req.body.add ?? []);
      await DepartmentService.detachHolderDepartments(holder, id, req.body.remove ?? []);
      res.status(204).end();
    },
  );
}

// `PUT /users/me/departments` was REMOVED (CP-SEC phase 50): self-assigning a department gave write access
// to its tasks under the per-department policy. Do not restore it: the reasons and the two legitimate
// paths are in `DOCUMENTATION/infrastructure/security.md`.
router.put(
  '/users/:id/departments',
  auth,
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: idsBody }),
  async (req, res) => {
    await DepartmentService.setUserDepartments(Number(req.params.id), req.body.ids);
    res.status(204).end();
  },
);

export default router;
