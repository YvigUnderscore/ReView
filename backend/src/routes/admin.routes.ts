// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import {
  getOidcConfig,
  getPublicOidcConfig,
  isOidcReady,
  setOidcConfig,
  oidcConfigSchema,
  type OidcConfig,
} from '../lib/oidcConfig';
import { storage } from '../services/StorageService';
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

// PUT /api/admin/oidc — enregistre la config SSO (secret write-only, chiffré)
router.put('/oidc', validate({ body: oidcConfigSchema }), async (req, res) => {
  const body = req.body as Record<string, unknown>;
  // « SSO seul » n'a de sens que si le SSO peut prendre le relais : sans ce contrôle,
  // l'instance se refermerait sur tout le monde, admins compris.
  const next = { ...(await getOidcConfig()), ...body } as OidcConfig;
  const patch = { ...body };
  if (next.passwordLoginDisabled && !isOidcReady(next)) {
    // Demande explicite de couper le mot de passe sans SSO opérationnel : refus net,
    // plutôt que de laisser l'admin le découvrir à sa prochaine connexion.
    if (body.passwordLoginDisabled === true) {
      throw badRequest(
        'Le SSO doit être activé et complet (issuer, client ID, secret, URL publique) avant de couper la connexion par mot de passe',
        'SSO_NOT_READY',
      );
    }
    // Sinon, c'est le SSO qu'on vient de désactiver ou de vider : le mot de passe
    // reprend la main de lui-même, au lieu de bloquer une modification légitime.
    patch.passwordLoginDisabled = false;
  }
  await setOidcConfig(patch);
  logAudit({ userId: req.user!.id, action: 'OIDC_CONFIG_UPDATE', entityType: 'Setting' });
  res.json({ oidc: await getPublicOidcConfig() });
});

// POST /api/admin/oidc/logo/presign — logo affiché dans le bouton SSO de la page de
// connexion. Même liste blanche que le logo studio : ces images sont servies depuis
// l'origine de l'app, donc pas de SVG (script exécutable).
router.post(
  '/oidc/logo/presign',
  validate({ body: z.object({ contentType: z.string().regex(/^image\/(png|jpe?g|webp)$/) }) }),
  async (req, res) => {
    const contentType = (req.body as { contentType: string }).contentType;
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
    const key = `branding/sso-${Date.now()}${ext}`;
    res.json({ key, url: await storage.getPresignedPutUrl(key, contentType, 900) });
  },
);

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
    if (r.count === 0) throw notFound('Token introuvable');
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
  const { page, pageSize } = readPagination(req.query);
  const [rows, total] = await Promise.all([
    prisma.mediaAccessLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        ip: true,
        shareLinkId: true,
        media: { select: { id: true, originalName: true, kind: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.mediaAccessLog.count(),
  ]);
  // Labels des liens de partage (pas de FK : le lien peut avoir été purgé).
  const shareIds = [...new Set(rows.map((r) => r.shareLinkId).filter((v): v is number => v != null))];
  const links = shareIds.length
    ? await prisma.shareLink.findMany({ where: { id: { in: shareIds } }, select: { id: true, label: true } })
    : [];
  const labelOf = new Map(links.map((l) => [l.id, l.label]));
  res.json({
    items: rows.map((r) => ({
      ...r,
      shareLabel: r.shareLinkId != null ? (labelOf.get(r.shareLinkId) ?? 'Lien supprimé') : null,
    })),
    total,
    page,
    pageSize,
  });
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
