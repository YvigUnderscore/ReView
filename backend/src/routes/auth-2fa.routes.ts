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
  consumeTotpOnce,
  hashBackupCode,
} from '../lib/twofa';
import { signAccessToken, signRefreshToken, verifyTwoFaToken } from '../lib/jwt';
import { createSession } from '../lib/sessions';
import { toSessionUser } from '../lib/userView';
import { logAudit } from '../services/AuditService';
import { badRequest, unauthorized } from '../lib/errors';

/** 2FA TOTP (36.A) — enrôlement, activation, désactivation, vérification au login. */
const router = Router();

/**
 * Un code TOTP (6 chiffres) ou un code de secours (128 bits en hexadécimal, groupé par 8
 * pour la recopie : 35 caractères séparateurs compris). Le plafond doit rester au-dessus
 * du plus long des deux, sinon la validation refuse le code de secours avant même de le
 * lire — c'est-à-dire précisément le jour où le téléphone est perdu.
 */
const codeSchema = z.string().min(6).max(64);

// POST /api/auth/2fa/setup — génère le secret (chiffré) et l'URI otpauth (QR côté client)
router.post('/setup', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw unauthorized();
  if (user.totpEnabledAt)
    throw badRequest('Two-factor authentication is already on', 'TWOFA_ALREADY_ENABLED');
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
  if (!user?.totpSecret) throw badRequest('No enrolment in progress — call /setup first');
  if (user.totpEnabledAt)
    throw badRequest('Two-factor authentication is already on', 'TWOFA_ALREADY_ENABLED');
  const secret = decryptSecret(user.totpSecret);
  if (!secret || !(await verifyTotp(secret, (req.body as { code: string }).code))) {
    throw unauthorized('Invalid code', 'TWOFA_BAD_CODE');
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
      throw unauthorized('Wrong password');
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
    message: { error: 'Too many attempts, try again later.' },
  }),
  validate({ body: z.object({ tmpToken: z.string(), code: codeSchema }) }),
  async (req, res) => {
    const { tmpToken, code } = req.body as { tmpToken: string; code: string };
    const userId = verifyTwoFaToken(tmpToken);
    if (!userId) throw unauthorized('Token expired — sign in again', 'TWOFA_TOKEN_EXPIRED');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || !user.totpEnabledAt) throw unauthorized('Two-factor authentication is not on');

    const secret = decryptSecret(user.totpSecret);
    // Un code TOTP ne vaut qu'une fois : sans cette consommation, le code intercepté se
    // rejoue pendant toute sa fenêtre (30 s + tolérance), et le second facteur ne prouve
    // plus la possession du téléphone. Le refus est indistinguable d'un code faux.
    let ok = secret ? (await verifyTotp(secret, code)) && consumeTotpOnce(user.id, code) : false;
    if (!ok) {
      // Code de secours (consommé définitivement). La suppression passe par un `updateMany`
      // conditionné au code encore présent : deux requêtes concurrentes portant le même
      // code se sérialisent sur la ligne, et la seconde ne trouve plus rien à consommer.
      const rest = consumeBackupCode(user.backupCodes, code);
      if (rest) {
        const consumed = await prisma.user.updateMany({
          where: { id: user.id, backupCodes: { has: hashBackupCode(code) } },
          data: { backupCodes: rest },
        });
        if (consumed.count === 1) {
          logAudit({ userId: user.id, action: 'TWOFA_BACKUP_USED', entityType: 'User', entityId: user.id });
          ok = true;
        }
      }
    }
    if (!ok) {
      logAudit({ userId: user.id, action: 'TWOFA_FAIL', entityType: 'User', entityId: user.id });
      throw unauthorized('Invalid code', 'TWOFA_BAD_CODE');
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
