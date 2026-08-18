// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { isValidDiscordWebhook } from '../lib/sanitize';
import { badRequest, notFound } from '../lib/errors';
import { paginationQuery, readPagination } from '../lib/pagination';
import * as AuditService from '../services/AuditService';
import { storage } from '../services/StorageService';
import { imageTypeFromKey } from '../lib/uploadContentType';
import { getLoginAppearance, loginBgUrl } from '../lib/loginAppearance';
import { getSourceUrl } from '../lib/settings';

const router = Router();

// GET /api/studio/branding — identité visuelle **publique** (42.B — №101) : utilisée par la
// page de connexion (pré-auth) et le bootstrap de l'app pour l'accent + le logo + le nom.
// Porte aussi `sourceUrl` : l'AGPL §13 impose d'offrir le code source à tout utilisateur
// distant, y compris non authentifié (connexion, partage client).
router.get('/branding', async (_req, res) => {
  const [studio, accent, logoKey, sourceUrl, login] = await Promise.all([
    prisma.studio.findFirst({ select: { name: true } }),
    prisma.setting.findUnique({ where: { key: 'studio_accent' } }),
    prisma.setting.findUnique({ where: { key: 'studio_logo_key' } }),
    getSourceUrl(),
    getLoginAppearance(),
  ]);
  const logoUrl = logoKey?.value
    ? await storage.getPresignedGetUrl(logoKey.value, 3600, imageTypeFromKey(logoKey.value))
    : null;
  res.json({
    name: studio?.name ?? null,
    accent: accent?.value ?? null,
    logoUrl,
    sourceUrl,
    // La page de connexion est pré-auth : son habillage doit voyager avec le branding
    // public, sinon l'image de fond n'apparaît qu'une fois connecté — c'est-à-dire jamais.
    login: { ...login, bgUrl: await loginBgUrl(login.bgKey) },
  });
});

router.use(authenticate);

// GET /api/studio — infos du studio (singleton)
// Sélection explicite : la ligne Studio porte `discordWebhookUrl`, un secret d'intégration
// qui permet de publier dans le Discord du studio. Un `findFirst()` nu le renvoyait à tout
// compte authentifié, comptes CLIENT externes compris.
router.get('/', async (req, res) => {
  const studio = await prisma.studio.findFirst({
    select: { id: true, name: true, slug: true, discordWebhookUrl: true, createdAt: true, updatedAt: true },
  });
  if (!studio) throw notFound('Studio not set up');
  const { discordWebhookUrl, ...rest } = studio;
  // L'URL elle-même n'est utile qu'à l'admin qui la configure (PATCH ci-dessous) ; les
  // autres n'ont besoin que de savoir si l'intégration est active.
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
    // Le journal d'audit est la seule trace des changements de configuration privilegies.
    // Jamais l'URL du webhook elle-meme : un journal consultable ne doit pas devenir la
    // nouvelle cachette du secret.
    AuditService.logAudit({
      userId: req.user!.id,
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
 * Réglages qui portent un secret et ne doivent jamais sortir de la base.
 * La table `Setting` est un fourre-tout clé/valeur : elle mélange des quotas anodins et des
 * secrets (config SMTP chiffrée, paire de clés VAPID dont la MOITIÉ PRIVÉE signe toutes les
 * notifications push de l'instance). Une exclusion nommant un seul réglage laissait sortir
 * tous ceux ajoutés depuis — c'est la liste qui doit être exhaustive, pas la mémoire.
 */
const SECRET_SETTING_KEYS = ['smtp_config', 'vapid_keys'];

// GET /api/studio/settings — réglages clé/valeur (admin), secrets exclus.
router.get('/settings', requireRole(Role.ADMIN), async (_req, res) => {
  const settings = await prisma.setting.findMany({
    where: { key: { notIn: SECRET_SETTING_KEYS } },
  });
  res.json({ settings: Object.fromEntries(settings.map((s) => [s.key, s.value])) });
});

// PUT /api/studio/settings — upsert d'un réglage (admin) : quotas, limites upload…
router.put(
  '/settings',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ key: z.string().min(1).max(100), value: z.string().max(2000) }) }),
  async (req, res) => {
    const { key, value } = req.body as { key: string; value: string };
    // Les secrets ont leurs propres routes (chiffrement, génération) : les laisser passer
    // par cet upsert générique permettrait d'écraser la config SMTP ou la paire VAPID par
    // du texte arbitraire — et de les relire ensuite sous une clé non filtrée.
    if (SECRET_SETTING_KEYS.includes(key))
      throw badRequest('This setting has its own endpoint', 'RESERVED_SETTING');
    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    AuditService.logAudit({
      userId: req.user!.id,
      action: 'SETTING_UPDATE',
      entityType: 'Setting',
      metadata: { key },
    });
    res.json({ setting });
  },
);

// GET /api/studio/audit — flux d'audit paginé + auteur/avatar (admin) — { items, total, … } (10.D1)
router.get('/audit', requireRole(Role.ADMIN), validate({ query: paginationQuery }), async (req, res) => {
  res.json(await AuditService.list(readPagination(req.query)));
});

export default router;
