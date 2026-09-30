// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as AuditService from '../services/AuditService';
import { storage } from '../services/StorageService';
import { imageTypeFromKey } from '../lib/uploadContentType';
import { brandingUploadSchema, presignBrandingUpload } from '../lib/branding';
import { getWatermarkConfig, setWatermarkConfig, watermarkConfigSchema } from '../lib/watermarkConfig';
import {
  getLoginAppearance,
  setLoginAppearance,
  loginAppearanceSchema,
  loginBgUrl,
} from '../lib/loginAppearance';

/**
 * Habillage du studio : logo, watermark, page de connexion. Ce qui se voit avant d'entrer
 * (le branding public) reste dans `studio.routes` — ici, tout exige d'être connecté, et
 * l'écriture d'être admin.
 */
const router = Router();
router.use(authenticate);

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
  validate({ body: brandingUploadSchema }),
  async (req, res) => {
    res.json(await presignBrandingUpload('logo', (req.body as { contentType: string }).contentType));
  },
);

// GET /api/studio/login-appearance — habillage de la page de connexion (admin) : la config
// brute (clé de l'image comprise) + l'URL présignée pour l'aperçu.
router.get('/login-appearance', requireRole(Role.ADMIN), async (_req, res) => {
  const login = await getLoginAppearance();
  res.json({ login: { ...login, bgUrl: await loginBgUrl(login.bgKey) } });
});

// PUT /api/studio/login-appearance — enregistre l'habillage (admin), patch partiel.
router.put(
  '/login-appearance',
  requireRole(Role.ADMIN),
  validate({ body: loginAppearanceSchema }),
  async (req, res) => {
    const login = await setLoginAppearance(req.body);
    // La page de connexion est la vitrine de l'instance : sa modification se trace comme
    // les autres changements de configuration visibles de l'extérieur.
    AuditService.logAudit({
      userId: req.user!.id,
      action: 'SETTING_UPDATE',
      entityType: 'Setting',
      metadata: { key: 'login_appearance' },
    });
    res.json({ login: { ...login, bgUrl: await loginBgUrl(login.bgKey) } });
  },
);

// POST /api/studio/login-appearance/bg/presign — upload de l'image de fond (admin).
// La clé retournée est ensuite enregistrée via PUT /login-appearance.
router.post(
  '/login-appearance/bg/presign',
  requireRole(Role.ADMIN),
  validate({ body: brandingUploadSchema }),
  async (req, res) => {
    res.json(await presignBrandingUpload('login-bg', (req.body as { contentType: string }).contentType));
  },
);

export default router;
