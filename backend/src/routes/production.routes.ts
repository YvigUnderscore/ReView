// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requireProjectManage } from '../middleware/rbac';
import * as StatsService from '../services/StatsService';
import * as ScheduleService from '../services/ScheduleService';
import * as ProductionService from '../services/ProductionService';
import * as GridService from '../services/GridService';

/**
 * Production & reporting (Phase 43, étendu Phase 50) — suivi de production par projet.
 *
 * Monté sous /api/projects.
 *
 * **Toutes ces lectures sont réservées à qui GÈRE le projet** (`requireProjectManage`, donc
 * CLIENT exclu). Elles étaient ouvertes à tout membre : l'onglet exposait la charge
 * NOMINATIVE de chaque artiste, ses retards et les tâches que personne n'a prises — de
 * l'information interne qu'un client invité sur un projet n'a aucune raison de lire, et
 * qu'il pouvait obtenir en appelant l'API directement.
 */
const router = Router();
router.use(authenticate);

const projectIdParam = z.object({ projectId: z.coerce.number().int() });

// GET /api/projects/:projectId/stats — temps par shot, notes/retakes, convergence par séquence
router.get(
  '/:projectId/stats',
  validate({ params: projectIdParam }),
  requireProjectManage,
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
  requireProjectManage,
  async (req, res) => {
    const weeks = req.query.weeks ? Number(req.query.weeks) : undefined;
    res.json(await ProductionService.getOverview(Number(req.params.projectId), weeks));
  },
);

/**
 * GET /api/projects/:projectId/schedule?from=&to= — tâches datées (calendrier + Gantt).
 *
 * La fenêtre borne la lecture : un Gantt n'affiche jamais qu'un mois ou un trimestre, et
 * sans elle la route rapatriait tout le projet daté. Les deux bornes restent facultatives
 * — absentes, la réponse est celle d'avant, au plafond de sécurité près, qu'elle annonce
 * alors par `truncated`.
 */
const scheduleQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/:projectId/schedule',
  validate({ params: projectIdParam, query: scheduleQuery }),
  requireProjectManage,
  async (req, res) => {
    // `validate` a déjà converti les bornes ; on relit par le même schéma pour les typer.
    const { from, to } = scheduleQuery.parse(req.query);
    res.json(await ScheduleService.getProjectSchedule(Number(req.params.projectId), { from, to }));
  },
);

/**
 * GET /api/projects/:projectId/grid — grille de suivi (plans × départements).
 *
 * **La pagination est PAR PLAN.** Une ligne est un plan avec toutes ses cases : un curseur
 * qui compterait des tâches couperait une ligne en deux. `cursor` vient toujours du
 * `nextCursor` de la réponse précédente ; les cinq filtres sont facultatifs et cumulatifs.
 */
const gridQuery = z.object({
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(GridService.GRID_MAX_LIMIT).optional(),
  episodeId: z.coerce.number().int().positive().optional(),
  sequenceId: z.coerce.number().int().positive().optional(),
  /** CLÉ du département (`comp`), pas son libellé — c'est la clé que portent les tâches. */
  department: z.string().min(1).max(100).optional(),
  assigneeId: z.coerce.number().int().positive().optional(),
  /** Code de statut du studio, ou valeur de l'enum figé à défaut de référentiel. */
  status: z.string().min(1).max(60).optional(),
});

router.get(
  '/:projectId/grid',
  validate({ params: projectIdParam, query: gridQuery }),
  requireProjectManage,
  async (req, res) => {
    // En Express 5, `req.query` est un getter : la coercition du middleware ne persiste
    // pas. On relit par le même schéma pour obtenir des nombres, comme le planning.
    res.json(await GridService.getProjectGrid(Number(req.params.projectId), gridQuery.parse(req.query)));
  },
);

export default router;
