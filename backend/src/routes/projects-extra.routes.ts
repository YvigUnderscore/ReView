// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole, requireProjectAccess, requireProjectManage } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { projectSettingsPatchSchema, type ProjectSettingsPatch } from '../lib/projectSettings';
import { CSV_FIELDS } from '../lib/projectCsvColumns';
import * as ProjectService from '../services/ProjectService';
import * as ProjectImportService from '../services/ProjectImportService';
import * as DepartmentService from '../services/DepartmentService';

/**
 * Additional project routes (Phase 38), mounted BEFORE projects.routes so that the specific paths
 * (`/usage`, `/:id/duplicate`, `/:id/usage`) take precedence over the generic `GET /:projectId`.
 * Duplication (38.A), storage usage and quotas (38.D), and reading and writing overrides of the
 * settings (studio inheritance).
 */
const router = Router();
router.use(authenticate);

const projectIdParam = z.object({ projectId: z.coerce.number().int() });

// GET /api/projects/usage — storage consumption of all projects (38.D, admin and supervisor).
router.get('/usage', requireRole(Role.ADMIN, Role.SUPERVISOR), async (_req, res) => {
  res.json({ projects: await ProjectService.listUsage() });
});

// POST /api/projects/:projectId/duplicate — copies the structure (+ optional tasks), without media (38.A).
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
      requireUser(req),
      Number(req.params.projectId),
      name,
      includeTasks ?? false,
    );
    res.status(201).json({ project });
  },
);

// GET /api/projects/:projectId/usage — storage usage and quota of the project (38.D).
router.get(
  '/:projectId/usage',
  validate({ params: projectIdParam }),
  requireProjectAccess,
  async (req, res) => {
    res.json(await ProjectService.getProjectUsage(Number(req.params.projectId)));
  },
);

// GET /api/projects/:projectId/import-csv/template — import template, full header.
router.get(
  '/:projectId/import-csv/template',
  validate({ params: projectIdParam }),
  requireProjectManage,
  (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="review-import-template.csv"');
    res.send(ProjectImportService.template());
  },
);

// POST /api/projects/:projectId/import-csv — bill-of-materials import (38.F).
// `commit=false` (default) returns the preview: what would be created, updated, left as is, and the
// refused rows with their reason. No write happens until `commit` is true.
const importBody = z.object({
  csv: z.string().min(1).max(1_000_000),
  commit: z.boolean().optional(),
  // Mapping imposed by the user when the file's header does not speak our vocabulary:
  // `field: null` neutralizes the column.
  mapping: z
    .array(z.object({ index: z.number().int().min(0).max(999), field: z.enum(CSV_FIELDS).nullable() }))
    .max(200)
    .optional(),
});
router.post(
  '/:projectId/import-csv',
  validate({ params: projectIdParam, body: importBody }),
  requireProjectManage,
  async (req, res) => {
    const { csv, commit, mapping } = req.body as z.infer<typeof importBody>;
    const projectId = Number(req.params.projectId);
    res.json(
      commit
        ? await ProjectImportService.commit(requireUser(req), projectId, csv, mapping ?? [])
        : await ProjectImportService.preview(projectId, csv, mapping ?? []),
    );
  },
);

// GET /api/projects/:projectId/settings/override — what the project ACTUALLY overrides (+ the studio
// defaults it inherits). Editing view: reserved to whoever manages the project.
router.get(
  '/:projectId/settings/override',
  validate({ params: projectIdParam }),
  requireProjectManage,
  async (req, res) => {
    res.json(await ProjectService.getSettingsOverride(Number(req.params.projectId)));
  },
);

// PATCH /api/projects/:projectId/settings — section-by-section write: an absent section means
// unchanged, a `null` section means back to studio inheritance.
router.patch(
  '/:projectId/settings',
  validate({ params: projectIdParam, body: projectSettingsPatchSchema }),
  requireProjectManage,
  async (req, res) => {
    res.json(
      await ProjectService.patchSettings(
        requireUser(req),
        Number(req.params.projectId),
        req.body as ProjectSettingsPatch,
      ),
    );
  },
);

// PATCH /api/projects/:projectId/members/:userId/departments — departments of a member on THIS project
// (batch 10). We tick and untick: replacing the whole list from a screen showing only one project would
// erase the steps that came from the others.
router.patch(
  '/:projectId/members/:userId/departments',
  validate({
    params: projectIdParam.extend({ userId: z.coerce.number().int().positive() }),
    body: z.object({
      add: z.array(z.number().int().positive()).max(50).optional(),
      remove: z.array(z.number().int().positive()).max(50).optional(),
    }),
  }),
  requireProjectManage,
  async (req, res) => {
    const departments = await DepartmentService.setMemberDepartments(
      requireUser(req),
      Number(req.params.projectId),
      Number(req.params.userId),
      req.body as { add?: number[]; remove?: number[] },
    );
    res.json({ departments });
  },
);

// GET /api/projects/:projectId/export-csv — export of shots and tasks as CSV (38.G).
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
