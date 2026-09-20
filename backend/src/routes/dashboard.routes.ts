// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as DashboardService from '../services/DashboardService';
import * as MyWorkService from '../services/MyWorkService';

const router = Router();
router.use(authenticate);

// GET /api/dashboard — données de la page Accueil (dernières reviews, activité,
// mes tâches, stats), bornées aux projets accessibles (membership ; admin/sup = tous).
router.get('/', async (req, res) => {
  res.json(await DashboardService.getDashboard(req.user!));
});

/**
 * GET /api/dashboard/tasks — mes tâches, tous projets confondus (page « mes tâches »).
 *
 * C'est la destination des deux cartes personnelles de l'Accueil, qui pointaient jusqu'ici
 * une ancre disparaissant avec le bloc « mes tâches ». `scope=blocked` déplie le compteur
 * de retakes, sans scope c'est tout ce qui m'est assigné et vivant.
 *
 * `projectId` sert le même contenu à la vue d'ensemble d'un projet : ce bloc et cette page
 * lisent le même périmètre, si bien qu'ils ne peuvent pas se contredire.
 */
router.get(
  '/tasks',
  validate({
    query: z
      .object({
        scope: z.enum(['all', 'blocked']).optional(),
        projectId: z.coerce.number().int().positive().optional(),
      })
      .merge(paginationQuery),
  }),
  async (req, res) => {
    const scope = req.query.scope === 'blocked' ? 'blocked' : 'all';
    // Express 5 : `req.query` est un getter, la coercition du middleware ne persiste pas.
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    res.json(await MyWorkService.listMyTasks(req.user!, scope, readPagination(req.query), projectId));
  },
);

/**
 * GET /api/dashboard/comments — les derniers commentaires de mon périmètre.
 *
 * La quatrième carte de l'Accueil compte des commentaires : elle mène désormais à une page
 * qui en montre. Un CLIENT n'y voit que les notes qui lui sont destinées (`lib/homeScope`).
 */
router.get('/comments', validate({ query: paginationQuery }), async (req, res) => {
  res.json(await MyWorkService.listMyComments(req.user!, readPagination(req.query)));
});

export default router;
