// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { rateLimit, identityRateKey } from '../middleware/rateLimit';
import { badRequest } from '../lib/errors';
import * as BackupCatalogService from '../services/BackupCatalogService';
import * as OpsService from '../services/OpsService';
import * as ReleaseService from '../services/ReleaseService';

/**
 * Exploitation de l'instance depuis l'administration : quelle version tourne, laquelle est
 * parue, ce qu'elle change, et quelles sauvegardes existent.
 *
 * Monté sous `/api/admin/ops`, **avant** le routeur générique `/api/admin`.
 */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

// Un jeton d'API n'exploite pas l'instance. Une ferme de rendu a besoin d'écrire des
// versions, jamais de savoir quand une mise à jour est disponible — et encore moins, une
// fois le lot d'exécution posé, de la commander sans personne devant l'écran.
router.use((req, _res, next) => {
  next(
    req.apiToken ? badRequest('An API token cannot operate the instance', 'API_TOKEN_FORBIDDEN') : undefined,
  );
});

// GET /api/admin/ops — tout ce que l'écran affiche, en une réponse.
router.get('/', async (_req, res) => {
  res.json(await OpsService.overview());
});

// GET /api/admin/ops/releases — le catalogue seul (cache de trente minutes).
router.get('/releases', async (_req, res) => {
  res.json(await ReleaseService.catalog());
});

// POST /api/admin/ops/releases/refresh — « Vérifier maintenant ».
//
// Borné par compte : sans jeton, l'API GitHub n'accorde que soixante appels par heure et
// par adresse. Un écran laissé ouvert sur un bouton cliquable épuiserait le quota de tout
// le studio en quelques minutes — et l'écran cesserait alors de renseigner qui que ce soit.
router.post(
  '/releases/refresh',
  rateLimit({ name: 'ops-release-refresh', windowMs: 60 * 60_000, max: 20, keyGenerator: identityRateKey }),
  async (_req, res) => {
    res.json(await ReleaseService.catalog({ force: true }));
  },
);

// GET /api/admin/ops/backups — catalogue des sauvegardes (manifestes seuls).
router.get('/backups', async (_req, res) => {
  res.json(await BackupCatalogService.list());
});

export default router;
