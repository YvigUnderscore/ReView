// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { isValidDiscordWebhook } from '../lib/sanitize';
import { badRequest, notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as AuditService from '../services/AuditService';
import { storage } from '../services/StorageService';
import { imageTypeFromKey } from '../lib/uploadContentType';
import { getLoginAppearance, loginBgUrl } from '../lib/loginAppearance';
import {
  BOOLEAN_SETTING_KEYS,
  booleanSettingSchema,
  getSourceUrl,
  isDraftModeEnabled,
} from '../lib/settings';

const router = Router();

// GET /api/studio/branding — **public** visual identity (42.B, item 101): used by the login page
// (pre-auth) and the app's bootstrap for the accent colour, the logo and the name. It also carries
// `sourceUrl`: AGPL §13 requires offering the source code to any remote user, including unauthenticated ones.
router.get('/branding', async (_req, res) => {
  const [studio, accent, logoKey, sourceUrl, login, draftMode] = await Promise.all([
    prisma.studio.findFirst({ select: { name: true } }),
    prisma.setting.findUnique({ where: { key: 'studio_accent' } }),
    prisma.setting.findUnique({ where: { key: 'studio_logo_key' } }),
    getSourceUrl(),
    getLoginAppearance(),
    isDraftModeEnabled(),
  ]);
  const logoUrl = logoKey?.value
    ? await storage.getPresignedGetUrl(logoKey.value, 3600, imageTypeFromKey(logoKey.value))
    : null;
  const { bgKey: _bgKey, ...loginPublic } = login;
  res.json({
    name: studio?.name ?? null,
    accent: accent?.value ?? null,
    logoUrl,
    sourceUrl,
    // Draft mode (Phase 50): a path boolean, not a secret. It travels here because it is the ONLY channel
    // everyone can read: admin settings are reserved to admins, and an artist must know whether "publish"
    // is still a gesture.
    draftMode,
    // The login page is pre-auth: its styling must travel with the public branding, otherwise the background
    // image would appear only once logged in, that is, never.
    //
    // `bgKey` is DROPPED from the rendering (CP-SEC of phase 50): it is the raw MinIO key, and it went out on
    // an UNAUTHENTICATED response, next to the presigned URL that makes it useless. The repository gave itself
    // the rule in phase 50 (`CommentService.publicAttachments`): "never the MinIO key, which would serve to sign
    // others". It was the only place where it was still broken.
    login: { ...loginPublic, bgUrl: await loginBgUrl(login.bgKey) },
  });
});

router.use(authenticate);

// GET /api/studio — studio info (singleton)
// Explicit selection: the Studio row carries `discordWebhookUrl`, an integration secret that lets one post
// to the studio's Discord. A bare `findFirst()` returned it to any authenticated account, external CLIENT
// accounts included.
router.get('/', async (req, res) => {
  const studio = await prisma.studio.findFirst({
    select: { id: true, name: true, slug: true, discordWebhookUrl: true, createdAt: true, updatedAt: true },
  });
  if (!studio) throw notFound('Studio not set up');
  const { discordWebhookUrl, ...rest } = studio;
  // The URL itself is only useful to the admin who configures it (PATCH below); the others only need to know
  // whether the integration is active.
  res.json({
    studio:
      req.user?.role === Role.ADMIN ? studio : { ...rest, hasDiscordWebhook: discordWebhookUrl != null },
  });
});

// PATCH /api/studio — config studio (admin)
router.patch(
  '/',
  requireRole(Role.ADMIN),
  validate({
    body: z.object({
      name: z.string().min(2).max(120).optional(),
      discordWebhookUrl: z.string().url().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as { name?: string; discordWebhookUrl?: string | null };
    if (body.discordWebhookUrl && !isValidDiscordWebhook(body.discordWebhookUrl)) {
      throw badRequest('Invalid Discord webhook URL', 'BAD_WEBHOOK');
    }
    const studio = await prisma.studio.findFirst();
    if (!studio) throw notFound('Studio not set up');
    const updated = await prisma.studio.update({ where: { id: studio.id }, data: body });
    // The audit log is the only trace of privileged configuration changes. Never the webhook URL itself: a
    // browsable log must not become the new hiding place of the secret.
    AuditService.logAudit({
      userId: requireUser(req).id,
      action: 'STUDIO_UPDATE',
      entityType: 'Studio',
      entityId: studio.id,
      metadata: {
        name: body.name ?? null,
        discordWebhookChanged: body.discordWebhookUrl !== undefined,
      },
    });
    res.json({ studio: updated });
  },
);

/**
 * Settings that carry a secret and must never leave the database.
 * The `Setting` table is a key/value catch-all: it mixes harmless quotas with secrets (encrypted SMTP config,
 * and the VAPID key pair whose PRIVATE HALF signs all of the instance's push notifications). An exclusion
 * naming a single setting let out all those added since: the list must be exhaustive, not left to memory.
 */
const SECRET_SETTING_KEYS = ['smtp_config', 'vapid_keys'];

// GET /api/studio/settings — key/value settings (admin), secrets excluded.
router.get('/settings', requireRole(Role.ADMIN), async (_req, res) => {
  const settings = await prisma.setting.findMany({
    where: { key: { notIn: SECRET_SETTING_KEYS } },
  });
  res.json({ settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) });
});

// PUT /api/studio/settings — upserts a setting (admin): quotas, upload limits…
router.put(
  '/settings',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ key: z.string().min(1).max(100), value: z.string().max(2000) }) }),
  async (req, res) => {
    const { key, value } = req.body as { key: string; value: string };
    // Secrets have their own routes (encryption, generation): letting them through this generic upsert would
    // allow overwriting the SMTP config or the VAPID pair with arbitrary text, and reading them back later
    // under an unfiltered key.
    if (SECRET_SETTING_KEYS.includes(key))
      throw badRequest('This setting has its own endpoint', 'RESERVED_SETTING');
    // Boolean settings (`draftMode`…): "true" or "false", nothing else. This upsert is generic and would
    // accept "oui" (French for yes), which would then read back as *false* without a word.
    if (BOOLEAN_SETTING_KEYS.includes(key)) booleanSettingSchema.parse(value);
    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    AuditService.logAudit({
      userId: requireUser(req).id,
      action: 'SETTING_UPDATE',
      entityType: 'Setting',
      metadata: { key },
    });
    res.json({ setting });
  },
);

// GET /api/studio/audit — paginated audit feed + author and avatar (admin) — { items, total, … } (10.D1)
router.get('/audit', requireRole(Role.ADMIN), validate({ query: paginationQuery }), async (req, res) => {
  res.json(await AuditService.list(readPagination(req.query)));
});

export default router;
