// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate, requireUser } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as AuditService from '../services/AuditService';
import { storage } from '../lib/storage';
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
 * Studio styling: logo, watermark, login page. What is visible before entering (the public branding)
 * stays in `studio.routes`: here, everything requires being logged in, and writing requires being admin.
 */
const router = Router();
router.use(authenticate);

// GET /api/studio/logo — presigned URL of the studio logo (all logged-in users)
router.get('/logo', async (_req, res) => {
  const setting = await prisma.setting.findUnique({ where: { key: 'studio_logo_key' } });
  res.json({
    url: setting?.value
      ? await storage.getPresignedGetUrl(setting.value, 3600, imageTypeFromKey(setting.value))
      : null,
  });
});

// GET /api/studio/watermark — watermark config (all logged-in users: viewers need it)
router.get('/watermark', async (_req, res) => {
  res.json({ watermark: await getWatermarkConfig() });
});

// PUT /api/studio/watermark — records the watermark config (admin)
router.put(
  '/watermark',
  requireRole(Role.ADMIN),
  validate({ body: watermarkConfigSchema }),
  async (req, res) => {
    res.json({ watermark: await setWatermarkConfig(req.body) });
  },
);

// POST /api/studio/logo/presign — upload of the studio logo (35.D: burn-ins and client page).
// The key is then recorded via PUT /settings (`studio_logo_key`).
router.post(
  '/logo/presign',
  requireRole(Role.ADMIN),
  validate({ body: brandingUploadSchema }),
  async (req, res) => {
    res.json(await presignBrandingUpload('logo', (req.body as { contentType: string }).contentType));
  },
);

// GET /api/studio/login-appearance — login page styling (admin): the raw config (image key included)
// plus the presigned URL for the preview.
router.get('/login-appearance', requireRole(Role.ADMIN), async (_req, res) => {
  const login = await getLoginAppearance();
  res.json({ login: { ...login, bgUrl: await loginBgUrl(login.bgKey) } });
});

// PUT /api/studio/login-appearance — records the styling (admin), partial patch.
router.put(
  '/login-appearance',
  requireRole(Role.ADMIN),
  validate({ body: loginAppearanceSchema }),
  async (req, res) => {
    const login = await setLoginAppearance(req.body);
    // The login page is the instance's showcase: changing it is traced like the other configuration
    // changes visible from outside.
    AuditService.logAudit({
      userId: requireUser(req).id,
      action: 'SETTING_UPDATE',
      entityType: 'Setting',
      metadata: { key: 'login_appearance' },
    });
    res.json({ login: { ...login, bgUrl: await loginBgUrl(login.bgKey) } });
  },
);

// POST /api/studio/login-appearance/bg/presign — upload of the background image (admin).
// The returned key is then recorded via PUT /login-appearance.
router.post(
  '/login-appearance/bg/presign',
  requireRole(Role.ADMIN),
  validate({ body: brandingUploadSchema }),
  async (req, res) => {
    res.json(await presignBrandingUpload('login-bg', (req.body as { contentType: string }).contentType));
  },
);

export default router;
