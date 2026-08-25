// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role, TaskStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as PipelineStatusService from '../services/PipelineStatusService';

/**
 * Statuts de tâche et de plan personnalisables (Phase 48).
 * Lecture pour tous (badges, colonnes du kanban) ; administration réservée aux ADMIN.
 */
const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.coerce.number().int().positive() });
// Les séquences et les assets portent un statut depuis la phase 48 et le référentiel en
// contient : les refuser ici renvoyait un 400 à chaque badge, qui restait donc invisible.
// La création à la main reste réservée aux deux périmètres éditables — les statuts de
// séquence et d'asset viennent du site, qui en tient la liste de référence.
const scopeSchema = z.enum(['task', 'shot', 'sequence', 'asset']);
const editableScope = z.enum(['task', 'shot']);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue (#RRGGBB)');

const statusBody = z.object({
  scope: editableScope,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  color: colorSchema,
  order: z.number().int().min(0).optional(),
  isDone: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  legacyStatus: z.nativeEnum(TaskStatus).nullish(),
  // Portée du statut créé (B2) : absent = référentiel du studio, sinon vocabulaire propre
  // à ce projet.
  projectId: z.number().int().positive().nullish(),
});

router.get(
  '/',
  validate({
    query: z.object({
      scope: scopeSchema.optional(),
      // Le vocabulaire dépend du projet : celui du site sur un projet relié, le nôtre
      // sinon. Sans ce paramètre, on répond le référentiel entier — les deux mélangés.
      projectId: z.coerce.number().int().positive().optional(),
    }),
  }),
  async (req, res) => {
    // Express 5 : `req.query` n'est pas remplacé par la valeur validée, les nombres y
    // restent des chaînes. On relit donc la valeur brute plutôt que de la supposer.
    const scope = req.query.scope as PipelineStatusService.Scope | undefined;
    const projectId = req.query.projectId ? Number(req.query.projectId) : null;
    res.json({
      statuses: projectId
        ? await PipelineStatusService.listForProject(projectId, scope)
        : await PipelineStatusService.list(scope),
    });
  },
);

router.post('/', requireRole(Role.ADMIN), validate({ body: statusBody }), async (req, res) => {
  const { projectId, ...input } = req.body as { projectId?: number | null };
  res.status(201).json({ status: await PipelineStatusService.create(input as never, projectId ?? null) });
});

router.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate({ params: idParam, body: statusBody.partial() }),
  async (req, res) => {
    res.json({ status: await PipelineStatusService.update(Number(req.params.id), req.body) });
  },
);

router.delete('/:id', requireRole(Role.ADMIN), validate({ params: idParam }), async (req, res) => {
  await PipelineStatusService.remove(Number(req.params.id));
  res.status(204).end();
});

router.post(
  '/reorder',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ scope: scopeSchema, ids: z.array(z.number().int().positive()) }) }),
  async (req, res) => {
    res.json({ statuses: await PipelineStatusService.reorder(req.body.scope, req.body.ids) });
  },
);

export default router;
