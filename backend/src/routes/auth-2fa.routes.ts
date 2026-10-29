// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authenticate, requireUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import {
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
  generateBackupCodes,
  consumeBackupCode,
  consumeTotpOnceShared,
  hashBackupCode,
} from '../lib/twofa';
import { signAccessToken, signRefreshToken, verifyTwoFaToken } from '../lib/jwt';
import { createSession } from '../lib/sessions';
import { toSessionUser } from '../lib/userView';
import { logAudit } from '../services/AuditService';
import { badRequest, unauthorized } from '../lib/errors';

/** 2FA TOTP (36.A): enrolment, activation, deactivation, verification at login. */
const router = Router();

/**
 * A TOTP code (6 digits) or a backup code (128 bits in hexadecimal, grouped by 8 for transcription:
 * 35 characters including separators). The ceiling must stay above the longer of the two, otherwise
 * the validation refuses the backup code before even reading it, that is, precisely on the day the
 * phone is lost.
 */
const codeSchema = z.string().min(6).max(64);

/**
 * Two brakes on the second-factor verification, as on the login.
 *
 * A single per-IP bucket made both errors at once: fifteen hits for a whole studio behind a NAT exit
 * (the sixteenth arrival in the morning could no longer validate their code), and no bound on the
 * targeted account as soon as attempts came from several machines. The per-account brake reads the
 * `tmpToken`, which NAMES the account: it is the only identity available here, since the bearer does
 * not have a session yet.
 */
const TOO_MANY = { error: 'Too many attempts, try again later.' };
const twoFaIpLimiter = rateLimit({ name: '2fa-ip', windowMs: 15 * 60_000, max: 100, message: TOO_MANY });
const twoFaAccountLimiter = rateLimit({
  name: '2fa-account',
  windowMs: 15 * 60_000,
  max: 10,
  message: TOO_MANY,
  keyGenerator: (req) => {
    const tmpToken = (req.body as { tmpToken?: unknown } | null | undefined)?.tmpToken;
    const userId = typeof tmpToken === 'string' ? verifyTwoFaToken(tmpToken) : null;
    return userId != null ? `u:${userId}` : `ip:${req.ip ?? 'unknown'}`;
  },
});

// POST /api/auth/2fa/setup — generates the secret (encrypted) and the otpauth URI (QR code on the client side)
router.post('/setup', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: requireUser(req).id } });
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

// POST /api/auth/2fa/enable — confirms enrolment with a code; returns the backup codes
router.post('/enable', authenticate, validate({ body: z.object({ code: codeSchema }) }), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: requireUser(req).id } });
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

// POST /api/auth/2fa/disable — deactivation (password required)
router.post(
  '/disable',
  authenticate,
  validate({ body: z.object({ password: z.string().min(1).max(128) }) }),
  async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: requireUser(req).id } });
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

// POST /api/auth/2fa/verify — exchanges { tmpToken, TOTP code or backup code } for tokens
router.post(
  '/verify',
  twoFaIpLimiter,
  validate({ body: z.object({ tmpToken: z.string(), code: codeSchema }) }),
  twoFaAccountLimiter,
  async (req, res) => {
    const { tmpToken, code } = req.body as { tmpToken: string; code: string };
    const userId = verifyTwoFaToken(tmpToken);
    if (!userId) throw unauthorized('Token expired — sign in again', 'TWOFA_TOKEN_EXPIRED');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || !user.totpEnabledAt) throw unauthorized('Two-factor authentication is not on');
    // Offboarding (A1-01): the account may have been deactivated between the password and the code.
    // The second factor is not one more gate, it is the same gate: it closes here too, otherwise 2FA
    // would hand the leaver the token that /login has just refused them.
    if (user.disabledAt) throw unauthorized('Account disabled', 'ACCOUNT_DISABLED');

    const secret = decryptSecret(user.totpSecret);
    // A TOTP code is valid only once: without this consumption, the intercepted code could be replayed
    // for its whole window (30 s plus tolerance), and the second factor would no longer prove possession
    // of the phone. The refusal is indistinguishable from a wrong code.
    //
    // Consumption is SHARED (Redis) rather than local to the process: the process guard does not see the
    // attempt served by another replica, so the same code would simply go through again by landing on
    // the second one. It fails closed if the marker is down — cf. `lib/twofa.consumeTotpOnceShared`.
    let ok = secret
      ? (await verifyTotp(secret, code)) && (await consumeTotpOnceShared(user.id, code))
      : false;
    if (!ok) {
      // Backup code (consumed for good). The deletion goes through an `updateMany` conditioned on the
      // code still being present: two concurrent requests carrying the same code are serialized on the
      // row, and the second one finds nothing left to consume.
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
