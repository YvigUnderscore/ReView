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
 * Operating the instance from the administration: which version is running, which one has been
 * released, what it changes, and which backups exist.
 *
 * Mounted under `/api/admin/ops`, **before** the generic `/api/admin` router.
 */
const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

// An API token does not operate the instance. A render farm needs to write versions, never to know
// when an update is available, and even less, once the execution batch is in place, to order one with
// nobody in front of the screen.
router.use((req, _res, next) => {
  next(
    req.apiToken ? badRequest('An API token cannot operate the instance', 'API_TOKEN_FORBIDDEN') : undefined,
  );
});

// GET /api/admin/ops — everything the screen displays, in one response.
router.get('/', async (_req, res) => {
  res.json(await OpsService.overview());
});

// GET /api/admin/ops/releases — the catalog alone (thirty-minute cache).
router.get('/releases', async (_req, res) => {
  res.json(await ReleaseService.catalog());
});

// POST /api/admin/ops/releases/refresh — "Check now".
//
// Bounded per account: without a token, the GitHub API grants only sixty calls per hour and per address.
// A screen left open on a clickable button would exhaust the quota of the whole studio within minutes,
// and the screen would then stop informing anyone.
router.post(
  '/releases/refresh',
  rateLimit({ name: 'ops-release-refresh', windowMs: 60 * 60_000, max: 20, keyGenerator: identityRateKey }),
  async (_req, res) => {
    res.json(await ReleaseService.catalog({ force: true }));
  },
);

// GET /api/admin/ops/backups — backup catalog (manifests only).
router.get('/backups', async (_req, res) => {
  res.json(await BackupCatalogService.list());
});

export default router;
