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
import { authenticate } from '../middleware/auth';
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

const router = Router();
router.use(authenticate, requireRole(Role.ADMIN));

// GET /api/admin/project-defaults — réglages par défaut des nouveaux projets
router.get('/project-defaults', async (_req, res) => {
  res.json({ settings: await getStudioProjectDefaults() });
});

// PUT /api/admin/project-defaults — départements + nomenclature + pipeline par défaut
router.put('/project-defaults', validate({ body: projectSettingsSchema }), async (req, res) => {
  const settings = await setStudioProjectDefaults(req.body);
  logAudit({ userId: req.user!.id, action: 'PROJECT_DEFAULTS_UPDATE', entityType: 'Setting' });
  res.json({ settings });
});

// GET /api/admin/transcode — config de transcodage vidéo (contexte Vidéo)
router.get('/transcode', async (_req, res) => {
  res.json({ config: await getTranscodeConfig() });
});

// PUT /api/admin/transcode — enregistre la config de transcodage (lue par le worker HLS)
router.put('/transcode', validate({ body: transcodeConfigSchema }), async (req, res) => {
  const config = await setTranscodeConfig(req.body);
  logAudit({ userId: req.user!.id, action: 'TRANSCODE_CONFIG_UPDATE', entityType: 'Setting' });
  res.json({ config });
});

// GET /api/admin/burnin — template studio des burn-ins/slates (35.A)
router.get('/burnin', async (_req, res) => {
  res.json({ config: await getStudioBurninConfig() });
});

// PUT /api/admin/burnin — enregistre le template (appliqué aux prochains transcodages)
router.put('/burnin', validate({ body: burninConfigSchema }), async (req, res) => {
  const config = await setStudioBurninConfig(req.body);
  logAudit({ userId: req.user!.id, action: 'BURNIN_CONFIG_UPDATE', entityType: 'Setting' });
  res.json({ config });
});

// GET/PUT /api/admin/derived-purge — purge des dérivés obsolètes (37.H) + exécution manuelle
router.get('/derived-purge', async (_req, res) => {
  res.json({ config: await getDerivedPurgeConfig() });
});
router.put('/derived-purge', validate({ body: derivedPurgeSchema }), async (req, res) => {
  const config = await setDerivedPurgeConfig(req.body);
  logAudit({ userId: req.user!.id, action: 'DERIVED_PURGE_CONFIG', entityType: 'Setting' });
  res.json({ config });
});
router.post('/derived-purge/run', async (req, res) => {
  const result = await purgeObsoleteDerived();
  logAudit({
    userId: req.user!.id,
    action: 'DERIVED_PURGE_RUN',
    entityType: 'Setting',
    metadata: result,
  });
  res.json(result);
});

// GET /api/admin/oidc — config SSO (36.A, sans le secret)
router.get('/oidc', async (_req, res) => {
  res.json({ oidc: await getPublicOidcConfig() });
});

// PUT /api/admin/oidc — enregistre la config SSO (secret write-only, chiffré). La garde
// « SSO seul » vit dans lib/oidcConfig : c'est elle qui empêche l'instance de se refermer.
router.put('/oidc', validate({ body: oidcConfigSchema }), async (req, res) => {
  await updateOidcConfig(req.body as Record<string, unknown>);
  logAudit({ userId: req.user!.id, action: 'OIDC_CONFIG_UPDATE', entityType: 'Setting' });
  res.json({ oidc: await getPublicOidcConfig() });
});

// POST /api/admin/oidc/logo/presign — logo affiché dans le bouton SSO de la page de connexion.
router.post('/oidc/logo/presign', validate({ body: brandingUploadSchema }), async (req, res) => {
  res.json(await presignBrandingUpload('sso', (req.body as { contentType: string }).contentType));
});

// GET /api/admin/api-tokens — tous les tokens d'API du studio (36.C, jamais le secret)
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

// DELETE /api/admin/api-tokens/:id — révocation par un admin (n'importe quel compte)
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
      userId: req.user!.id,
      action: 'API_TOKEN_REVOKE',
      entityType: 'ApiToken',
      entityId: Number(req.params.id),
      metadata: { byAdmin: true },
    });
    res.status(204).end();
  },
);

// GET /api/admin/media-access — journal d'accès aux médias (36.E), paginé, récent d'abord
router.get('/media-access', validate({ query: paginationQuery }), async (req, res) => {
  res.json(await AdminService.mediaAccessLog(readPagination(req.query)));
});

// GET /api/admin/dashboard — métriques studio (compat. ascendante, vue compacte)
router.get('/dashboard', async (_req, res) => {
  res.json(await AdminService.dashboard());
});

// GET /api/admin/stats — métriques métier complètes (admin)
router.get('/stats', async (_req, res) => {
  res.json(await AdminService.stats());
});

// GET /api/admin/system — métriques système + santé des services (admin)
router.get('/system', async (_req, res) => {
  res.json(await AdminService.system());
});

// GET /api/admin/trash — projets supprimés (corbeille globale, admin)
router.get('/trash', async (_req, res) => {
  res.json({ projects: await AdminService.trashProjects() });
});

// POST /api/admin/jobs/retry — relance tous les jobs média en échec (admin)
router.post('/jobs/retry', async (req, res) => {
  res.json({ retried: await AdminService.retryFailedJobs(req.user!.id) });
});

export default router;
