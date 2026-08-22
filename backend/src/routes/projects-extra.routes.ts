// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole, requireProjectAccess, requireProjectManage } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { projectSettingsPatchSchema, type ProjectSettingsPatch } from '../lib/projectSettings';
import { CSV_FIELDS } from '../lib/projectCsvColumns';
import * as ProjectService from '../services/ProjectService';
import * as ProjectImportService from '../services/ProjectImportService';

/**
 * Routes projet additionnelles (Phase 38) montées AVANT projects.routes pour que les chemins
 * spécifiques (`/usage`, `/:id/duplicate`, `/:id/usage`) priment sur le `GET /:projectId`
 * générique. Duplication (38.A) + usage/quotas de stockage (38.D) + lecture/écriture
 * d'override des réglages (héritage studio).
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

// GET /api/projects/:projectId/import-csv/template — gabarit d'import, en-tête complet.
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

// POST /api/projects/:projectId/import-csv — import de nomenclature (38.F).
// `commit=false` (défaut) rend l'aperçu : ce qui serait créé, mis à jour, laissé tel quel,
// et les lignes refusées avec leur motif. Aucune écriture tant que `commit` n'est pas vrai.
const importBody = z.object({
  csv: z.string().min(1).max(1_000_000),
  commit: z.boolean().optional(),
  // Correspondance imposée par l'utilisateur quand l'en-tête du fichier ne parle pas
  // notre vocabulaire — `field: null` neutralise la colonne.
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
        ? await ProjectImportService.commit(req.user!, projectId, csv, mapping ?? [])
        : await ProjectImportService.preview(projectId, csv, mapping ?? []),
    );
  },
);

// GET /api/projects/:projectId/settings/override — ce que le projet surcharge RÉELLEMENT
// (+ les défauts studio dont il hérite). Vue d'édition : réservée à qui gère le projet.
router.get(
  '/:projectId/settings/override',
  validate({ params: projectIdParam }),
  requireProjectManage,
  async (req, res) => {
    res.json(await ProjectService.getSettingsOverride(Number(req.params.projectId)));
  },
);

// PATCH /api/projects/:projectId/settings — écriture SECTION PAR SECTION : section absente
// = inchangée, section `null` = retour à l'héritage studio.
router.patch(
  '/:projectId/settings',
  validate({ params: projectIdParam, body: projectSettingsPatchSchema }),
  requireProjectManage,
  async (req, res) => {
    res.json(
      await ProjectService.patchSettings(
        req.user!,
        Number(req.params.projectId),
        req.body as ProjectSettingsPatch,
      ),
    );
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
