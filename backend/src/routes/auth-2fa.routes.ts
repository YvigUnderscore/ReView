// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import {
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
  generateBackupCodes,
  consumeBackupCode,
} from '../lib/twofa';
import { signAccessToken, signRefreshToken, verifyTwoFaToken } from '../lib/jwt';
import { createSession } from '../lib/sessions';
import { toSessionUser } from '../lib/userView';
import { logAudit } from '../services/AuditService';
import { badRequest, unauthorized } from '../lib/errors';

/** 2FA TOTP (36.A) — enrôlement, activation, désactivation, vérification au login. */
const router = Router();

const codeSchema = z.string().min(6).max(20);

// POST /api/auth/2fa/setup — génère le secret (chiffré) et l'URI otpauth (QR côté client)
router.post('/setup', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw unauthorized();
  if (user.totpEnabledAt) throw badRequest('2FA déjà activée', 'TWOFA_ALREADY_ENABLED');
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: encryptSecret(secret), totpEnabledAt: null, backupCodes: [] },
  });
  const studio = await prisma.studio.findFirst({ select: { name: true } });
  res.json({ secret, otpauth: otpauthUri(user.email, studio?.name ?? 'ReView', secret) });
});

// POST /api/auth/2fa/enable — confirme l'enrôlement avec un code ; renvoie les codes de secours
router.post('/enable', authenticate, validate({ body: z.object({ code: codeSchema }) }), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user?.totpSecret) throw badRequest("Aucun enrôlement en cours (appelez d'abord /setup)");
  if (user.totpEnabledAt) throw badRequest('2FA déjà activée', 'TWOFA_ALREADY_ENABLED');
  const secret = decryptSecret(user.totpSecret);
  if (!secret || !(await verifyTotp(secret, (req.body as { code: string }).code))) {
    throw unauthorized('Code incorrect', 'TWOFA_BAD_CODE');
  }
  const { plain, hashes } = generateBackupCodes();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabledAt: new Date(), backupCodes: hashes },
  });
  logAudit({ userId: user.id, action: 'TWOFA_ENABLE', entityType: 'User', entityId: user.id });
  res.json({ enabled: true, backupCodes: plain });
});

// POST /api/auth/2fa/disable — désactivation (mot de passe requis)
router.post(
  '/disable',
  authenticate,
  validate({ body: z.object({ password: z.string().min(1).max(128) }) }),
  async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    if (!(await bcrypt.compare((req.body as { password: string }).password, user.password))) {
      throw unauthorized('Mot de passe incorrect');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null, backupCodes: [] },
    });
    logAudit({ userId: user.id, action: 'TWOFA_DISABLE', entityType: 'User', entityId: user.id });
    res.json({ enabled: false });
  },
);

// POST /api/auth/2fa/verify — échange { tmpToken, code TOTP ou code de secours } → tokens
router.post(
  '/verify',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { error: 'Trop de tentatives, réessayez plus tard.' },
  }),
  validate({ body: z.object({ tmpToken: z.string(), code: codeSchema }) }),
  async (req, res) => {
    const { tmpToken, code } = req.body as { tmpToken: string; code: string };
    const userId = verifyTwoFaToken(tmpToken);
    if (!userId) throw unauthorized('Jeton expiré — reconnectez-vous', 'TWOFA_TOKEN_EXPIRED');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || !user.totpEnabledAt) throw unauthorized('2FA non activée');

    const secret = decryptSecret(user.totpSecret);
    let ok = secret ? await verifyTotp(secret, code) : false;
    if (!ok) {
      // Code de secours (consommé définitivement).
      const rest = consumeBackupCode(user.backupCodes, code);
      if (rest) {
        await prisma.user.update({ where: { id: user.id }, data: { backupCodes: rest } });
        logAudit({ userId: user.id, action: 'TWOFA_BACKUP_USED', entityType: 'User', entityId: user.id });
        ok = true;
      }
    }
    if (!ok) {
      logAudit({ userId: user.id, action: 'TWOFA_FAIL', entityType: 'User', entityId: user.id });
      throw unauthorized('Code incorrect', 'TWOFA_BAD_CODE');
    }

    const sid = await createSession(user.id, req);
    const payload = { id: user.id, email: user.email, role: user.role, sid };
    res.json({
      token: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: await toSessionUser(user),
    });
  },
);

export default router;
