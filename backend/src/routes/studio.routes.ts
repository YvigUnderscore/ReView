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
import { getWatermarkConfig, setWatermarkConfig, watermarkConfigSchema } from '../lib/watermarkConfig';
import { getSourceUrl, resolveUserLocale } from '../lib/settings';
import * as UserService from '../services/UserService';
import { t } from '../i18n';
import * as SmtpService from '../services/SmtpService';
import { sendMail } from '../lib/mailer';
import { mailLayout } from '../lib/mailTemplate';

const router = Router();

// GET /api/studio/branding — identité visuelle **publique** (42.B — №101) : utilisée par la
// page de connexion (pré-auth) et le bootstrap de l'app pour l'accent + le logo + le nom.
// Porte aussi `sourceUrl` : l'AGPL §13 impose d'offrir le code source à tout utilisateur
// distant, y compris non authentifié (connexion, partage client).
router.get('/branding', async (_req, res) => {
  const [studio, accent, logoKey, sourceUrl] = await Promise.all([
    prisma.studio.findFirst({ select: { name: true } }),
    prisma.setting.findUnique({ where: { key: 'studio_accent' } }),
    prisma.setting.findUnique({ where: { key: 'studio_logo_key' } }),
    getSourceUrl(),
  ]);
  const logoUrl = logoKey?.value
    ? await storage.getPresignedGetUrl(logoKey.value, 3600, imageTypeFromKey(logoKey.value))
    : null;
  res.json({ name: studio?.name ?? null, accent: accent?.value ?? null, logoUrl, sourceUrl });
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
  if (!studio) throw notFound('Studio non configuré');
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
      throw badRequest('URL de webhook Discord invalide', 'BAD_WEBHOOK');
    }
    const studio = await prisma.studio.findFirst();
    if (!studio) throw notFound('Studio non configuré');
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
      throw badRequest('Ce réglage a une route dédiée', 'RESERVED_SETTING');
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

// GET /api/studio/logo — URL présignée du logo studio (tous les connectés)
router.get('/logo', async (_req, res) => {
  const setting = await prisma.setting.findUnique({ where: { key: 'studio_logo_key' } });
  res.json({
    url: setting?.value
      ? await storage.getPresignedGetUrl(setting.value, 3600, imageTypeFromKey(setting.value))
      : null,
  });
});

// GET /api/studio/watermark — config watermark (tous les connectés : les viewers en ont besoin)
router.get('/watermark', async (_req, res) => {
  res.json({ watermark: await getWatermarkConfig() });
});

// PUT /api/studio/watermark — enregistre la config watermark (admin)
router.put(
  '/watermark',
  requireRole(Role.ADMIN),
  validate({ body: watermarkConfigSchema }),
  async (req, res) => {
    res.json({ watermark: await setWatermarkConfig(req.body) });
  },
);

// POST /api/studio/logo/presign — upload du logo studio (35.D : burn-ins + page client).
// La clé est ensuite enregistrée via PUT /settings (`studio_logo_key`).
router.post(
  '/logo/presign',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ contentType: z.string().regex(/^image\/(png|jpe?g|webp)$/) }) }),
  async (req, res) => {
    const contentType = (req.body as { contentType: string }).contentType;
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
    const key = `branding/logo-${Date.now()}${ext}`;
    res.json({ key, url: await storage.getPresignedPutUrl(key, contentType, 900) });
  },
);

// GET /api/studio/audit — flux d'audit paginé + auteur/avatar (admin) — { items, total, … } (10.D1)
router.get('/audit', requireRole(Role.ADMIN), validate({ query: paginationQuery }), async (req, res) => {
  res.json(await AuditService.list(readPagination(req.query)));
});

const smtpSchema = z.object({
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().max(255).optional(),
  from: z.string().max(255).optional(),
  password: z.string().max(255).optional(), // write-only (jamais renvoyé)
});

// GET /api/studio/smtp — config SMTP sans mot de passe (admin)
router.get('/smtp', requireRole(Role.ADMIN), async (_req, res) => {
  res.json({ smtp: await SmtpService.getPublicConfig() });
});

// PUT /api/studio/smtp — enregistre la config (mot de passe chiffré, write-only) (admin)
router.put('/smtp', requireRole(Role.ADMIN), validate({ body: smtpSchema }), async (req, res) => {
  const smtp = await SmtpService.setConfig(req.body);
  // Le relais SMTP sortant est un pivot : qui le change peut detourner tout le courrier
  // de l'instance. Jamais le mot de passe dans le journal, seulement le fait du changement.
  AuditService.logAudit({
    userId: req.user!.id,
    action: 'SMTP_UPDATE',
    entityType: 'Setting',
    metadata: { host: req.body.host ?? null, passwordChanged: req.body.password !== undefined },
  });
  res.json({ smtp });
});

// POST /api/studio/smtp/test — envoie un email de test (admin)
router.post(
  '/smtp/test',
  requireRole(Role.ADMIN),
  validate({ body: z.object({ to: z.string().email() }) }),
  async (req, res) => {
    // L'email part dans la langue de l'admin qui déclenche le test : c'est lui qui le lit.
    const locale = await resolveUserLocale(await UserService.getPreferences(req.user!.id));
    const ok = await sendMail(
      req.body.to,
      t(locale, 'smtp.test.subject'),
      mailLayout(locale, t(locale, 'smtp.test.title'), `<p>${t(locale, 'smtp.test.body')}</p>`),
    );
    if (!ok) throw badRequest('Envoi impossible (SMTP non configuré ou erreur)', 'SMTP_SEND_FAILED');
    res.json({ sent: true });
  },
);

export default router;
