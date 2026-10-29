// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import { getPublicOidcConfig, updateOidcConfig, oidcConfigSchema } from '../lib/oidcConfig';
import { brandingUploadSchema, presignBrandingUpload } from '../lib/branding';
import {
  getDerivedPurgeConfig,
  setDerivedPurgeConfig,
  derivedPurgeSchema,
  purgeObsoleteDerived,
} from '../lib/derivedPurge';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { logAudit } from '../services/AuditService';
import {
  getStudioProjectDefaults,
  setStudioProjectDefaults,
  projectSettingsSchema,
} from '../lib/projectSettings';
import { getTranscodeConfig, setTranscodeConfig, transcodeConfigSchema } from '../lib/transcodeConfig';
import { getStudioBurninConfig, setStudioBurninConfig, burninConfigSchema } from '../lib/burnin';
import * as AdminService from '../services/AdminService';
import adminRetentionRoutes from './admin-retention.routes';

const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

// Log retention: /retention* routes (dedicated file, same guards as above).
router.use(adminRetentionRoutes);

// GET /api/admin/project-defaults — default settings for new projects
router.get('/project-defaults', async (_req, res) => {
  res.json({ settings: await getStudioProjectDefaults() });
});

// PUT /api/admin/project-defaults — departments + naming convention + default pipeline
router.put('/project-defaults', validate({ body: projectSettingsSchema }), async (req, res) => {
  const settings = await setStudioProjectDefaults(req.body);
  logAudit({ userId: requireUser(req).id, action: 'PROJECT_DEFAULTS_UPDATE', entityType: 'Setting' });
  res.json({ settings });
});

// GET /api/admin/transcode — video transcoding config (Video context)
router.get('/transcode', async (_req, res) => {
  res.json({ config: await getTranscodeConfig() });
});

// PUT /api/admin/transcode — records the transcoding config (read by the HLS worker)
router.put('/transcode', validate({ body: transcodeConfigSchema }), async (req, res) => {
  const config = await setTranscodeConfig(req.body);
  logAudit({ userId: requireUser(req).id, action: 'TRANSCODE_CONFIG_UPDATE', entityType: 'Setting' });
  res.json({ config });
});

// GET /api/admin/burnin — studio template for burn-ins and slates (35.A)
router.get('/burnin', async (_req, res) => {
  res.json({ config: await getStudioBurninConfig() });
});

// PUT /api/admin/burnin — records the template (applied to the next transcodes)
router.put('/burnin', validate({ body: burninConfigSchema }), async (req, res) => {
  const config = await setStudioBurninConfig(req.body);
  logAudit({ userId: requireUser(req).id, action: 'BURNIN_CONFIG_UPDATE', entityType: 'Setting' });
  res.json({ config });
});

// GET/PUT /api/admin/derived-purge — purge of obsolete derivatives (37.H) + manual run
router.get('/derived-purge', async (_req, res) => {
  res.json({ config: await getDerivedPurgeConfig() });
});
router.put('/derived-purge', validate({ body: derivedPurgeSchema }), async (req, res) => {
  const config = await setDerivedPurgeConfig(req.body);
  logAudit({ userId: requireUser(req).id, action: 'DERIVED_PURGE_CONFIG', entityType: 'Setting' });
  res.json({ config });
});
router.post('/derived-purge/run', async (req, res) => {
  const result = await purgeObsoleteDerived();
  logAudit({
    userId: requireUser(req).id,
    action: 'DERIVED_PURGE_RUN',
    entityType: 'Setting',
    metadata: result,
  });
  res.json(result);
});

// GET /api/admin/oidc — SSO config (36.A, without the secret)
router.get('/oidc', async (_req, res) => {
  res.json({ oidc: await getPublicOidcConfig() });
});

// PUT /api/admin/oidc — records the SSO config (secret write-only, encrypted). The "SSO only"
// guard lives in lib/oidcConfig: it is what prevents the instance from locking itself out.
router.put('/oidc', validate({ body: oidcConfigSchema }), async (req, res) => {
  await updateOidcConfig(req.body as Record<string, unknown>);
  logAudit({ userId: requireUser(req).id, action: 'OIDC_CONFIG_UPDATE', entityType: 'Setting' });
  res.json({ oidc: await getPublicOidcConfig() });
});

// POST /api/admin/oidc/logo/presign — logo displayed in the SSO button of the login page.
router.post('/oidc/logo/presign', validate({ body: brandingUploadSchema }), async (req, res) => {
  res.json(await presignBrandingUpload('sso', (req.body as { contentType: string }).contentType));
});

// GET /api/admin/api-tokens — all the studio's API tokens (36.C, never the secret)
router.get('/api-tokens', async (_req, res) => {
  const tokens = await prisma.apiToken.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  res.json({ tokens });
});

// DELETE /api/admin/api-tokens/:id — revocation by an admin (any account)
router.delete(
  '/api-tokens/:id',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const r = await prisma.apiToken.updateMany({
      where: { id: Number(req.params.id), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) throw notFound('Token not found');
    logAudit({
      userId: requireUser(req).id,
      action: 'API_TOKEN_REVOKE',
      entityType: 'ApiToken',
      entityId: Number(req.params.id),
      metadata: { byAdmin: true },
    });
    res.status(204).end();
  },
);

// GET /api/admin/media-access — media access log (36.E), paginated, most recent first
router.get('/media-access', validate({ query: paginationQuery }), async (req, res) => {
  res.json(await AdminService.mediaAccessLog(readPagination(req.query)));
});

// GET /api/admin/dashboard — studio metrics (backward compatible, compact view)
router.get('/dashboard', async (_req, res) => {
  res.json(await AdminService.dashboard());
});

// GET /api/admin/stats — full business metrics (admin)
router.get('/stats', async (_req, res) => {
  res.json(await AdminService.stats());
});

// GET /api/admin/system — system metrics + service health (admin)
router.get('/system', async (_req, res) => {
  res.json(await AdminService.system());
});

// GET /api/admin/trash — deleted projects (global trash, admin)
router.get('/trash', async (_req, res) => {
  res.json({ projects: await AdminService.trashProjects() });
});

// POST /api/admin/jobs/retry — re-runs all failed media jobs (admin)
router.post('/jobs/retry', async (req, res) => {
  res.json({ retried: await AdminService.retryFailedJobs(requireUser(req).id) });
});

export default router;
