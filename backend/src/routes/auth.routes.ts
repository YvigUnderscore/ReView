// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signAccessToken, signRefreshToken, signTwoFaToken, verifyToken } from '../lib/jwt';
import { createSession, isSessionActive, touchSession } from '../lib/sessions';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { rateLimit, targetAccountRateKey } from '../middleware/rateLimit';
import { toSessionUser, type RawSessionUser } from '../lib/userView';
import { normalizeEmail } from '../lib/email';
import { logLoginAttempt } from '../services/AuditService';
import * as InvitationService from '../services/InvitationService';
import { isPasswordLoginBlocked } from '../lib/oidcConfig';
import { env } from '../config/env';
import { badRequest, forbidden, unauthorized } from '../lib/errors';

const router = Router();

const passwordSchema = z
  .string()
  .min(8, 'Password: 8 characters minimum')
  .max(128)
  .regex(/[A-Za-z]/, 'At least one letter')
  .regex(/[0-9]/, 'At least one digit');

/**
 * bcrypt hash (cost 12) of a lost random value: no password verifies against it.
 *
 * It is used to make bcrypt work even when the address matches no account. Without it, the response
 * comes back about 100 ms earlier in that case: enough to enumerate the studio's addresses remotely,
 * without ever guessing a password.
 */
const ABSENT_ACCOUNT_HASH = '$2b$12$FZqqqvbZMoTW4t0AxtCNBOlpsEVwaNdSPZWu1.p/Q2tXt/kj3SMp2';

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().max(128),
});

// Two distinct brakes, not a shared budget: the IP protects the service and stays generous (a whole
// studio goes out through a single public address), while the ACCOUNT protects the password: a hundred
// accomplice machines remain bounded on the targeted address. Sign-up and invitation have their own space.
const loginIpLimiter = rateLimit({ name: 'auth-login-ip', windowMs: 15 * 60_000, max: 300 });
const signupLimiter = rateLimit({ name: 'auth-signup', windowMs: 15 * 60_000, max: 50 });
const loginAccountLimiter = rateLimit({
  name: 'auth-login-account',
  windowMs: 15 * 60_000,
  max: 10,
  keyGenerator: targetAccountRateKey,
});

/**
 * "SSO only" mode (studio): the password is no longer an entry point.
 *
 * The refusal also applies to open sign-up: an account created with an unusable password is not an
 * account, it is a trap, and it reserves a collaborator's email before their first SSO login.
 */
async function refusePasswordAuth(): Promise<void> {
  if (await isPasswordLoginBlocked()) {
    throw forbidden('Password sign-in is off — use SSO', 'PASSWORD_LOGIN_DISABLED');
  }
}

// Offboarding (A1-01): revoking a leaver's sessions was pointless as long as they could just retype
// their password. The refusal is named without revealing anything: it is only reached with the right password.
const refuseIfDisabled = (user: { disabledAt: Date | null }): void => {
  if (user.disabledAt) throw unauthorized('Account disabled', 'ACCOUNT_DISABLED');
};

/** Opens the session and returns the token pair: the shared response of `/login` and of activation. */
async function grantSession(user: RawSessionUser, req: Request, res: Response): Promise<void> {
  const sid = await createSession(user.id, req);
  const payload = { id: user.id, email: user.email, role: user.role, sid };
  const token = signAccessToken(payload);
  res.json({ token, refreshToken: signRefreshToken(payload), user: await toSessionUser(user) });
}

// POST /api/auth/register — creates an artist. Closed by default (ALLOW_SELF_REGISTRATION): otherwise
// anyone gets an authenticated account on the instance, and can reserve a collaborator's email before
// their first SSO login.
router.post(
  '/register',
  signupLimiter,
  validate({
    body: z.object({
      email: z.string().email().max(254),
      password: passwordSchema,
      name: z.string().max(120).optional(),
    }),
  }),
  async (req, res) => {
    if (!env.ALLOW_SELF_REGISTRATION) {
      throw forbidden('Open sign-up is off on this instance', 'REGISTRATION_DISABLED');
    }
    await refusePasswordAuth();
    const { password, name } = req.body as { password: string; name?: string };
    const email = normalizeEmail((req.body as { email: string }).email);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw badRequest('Email already in use', 'EMAIL_TAKEN');

    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hash, name: name ?? null, role: 'ARTIST' },
    });
    res.status(201).json({ user: await toSessionUser(user) });
  },
);

// POST /api/auth/login — revocable session (36.B); if 2FA is active, returns an intermediate token to
// exchange via /api/auth/2fa/verify (36.A). The per-account brake is set AFTER Zod validation: without
// a parsed body, its key would be whatever the caller chose to send.
const loginGuards = [loginIpLimiter, validate({ body: credentialsSchema }), loginAccountLimiter];
router.post('/login', loginGuards, async (req: Request, res: Response) => {
  await refusePasswordAuth();
  const { password } = req.body as { password: string };
  // Every write normalizes the address (sign-up, invitation, setup, OIDC provisioning). Looking it up as
  // typed made "Alice@Studio.com" unreachable for an account registered as "alice@studio.com".
  const email = normalizeEmail((req.body as { email: string }).email);
  const user = await prisma.user.findUnique({ where: { email } });
  // The comparison happens even without an account (dummy hash): that is what makes the refusal as
  // slow as a wrong password, hence silent about whether the address exists.
  const passwordOk = await bcrypt.compare(password, user?.password ?? ABSENT_ACCOUNT_HASH);
  // A service account (API v1) exists only to carry the writes of a machine token: it never logs in,
  // even if its random password leaked.
  const granted = !!user && passwordOk && !user.isService && !user.disabledAt;
  // A5-03: the verdict is recorded before being returned, refusals included: it is the first line one
  // looks for after an account theft. The call is identical in both branches and the write is not
  // awaited: no timing gap betrays the existence of the address.
  logLoginAttempt({ user, granted, email, ip: req.ip });
  if (!user || !passwordOk || user.isService) throw unauthorized('Invalid credentials', 'BAD_CREDENTIALS');
  refuseIfDisabled(user);
  if (user.totpEnabledAt) {
    res.json({ requires2fa: true, tmpToken: signTwoFaToken(user.id) });
    return;
  }
  await grantSession(user, req, res);
});

// POST /api/auth/refresh — requires an active session.
//
// ⚠ A refresh without `sid` is REFUSED: it does not obtain a fresh session. The "transparent migration"
// that manufactured one was the back door of the 36.B fix: closing `middleware/auth` is pointless if the
// legacy token that was just set aside is enough to walk away with a perfectly valid access token. The
// bearer logs in again.
router.post('/refresh', validate({ body: z.object({ refreshToken: z.string() }) }), async (req, res) => {
  const { refreshToken } = req.body as { refreshToken: string };
  const payload = verifyToken(refreshToken);
  if (!payload || payload.kind !== 'refresh') throw unauthorized('Invalid refresh token');
  const { sid } = payload;
  if (!sid) throw unauthorized('Session revoked', 'SESSION_REVOKED');
  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user) throw unauthorized('User not found');
  refuseIfDisabled(user);
  if (!(await isSessionActive(sid))) throw unauthorized('Session revoked', 'SESSION_REVOKED');
  await touchSession(sid);
  const next = { id: user.id, email: user.email, role: user.role, sid };
  res.json({ token: signAccessToken(next), refreshToken: signRefreshToken(next) });
});

// ── Invitation of a new member (Phase 47) ────────────────────────────────
// Public routes: the holder of the link has, by definition, no session yet.

const invitationTokenParam = z.object({ token: z.string().min(20).max(128) });

// GET /api/auth/invitation/:token — preview shown on the activation page
router.get(
  '/invitation/:token',
  signupLimiter,
  validate({ params: invitationTokenParam }),
  async (req, res) => {
    res.json({ invitation: await InvitationService.describeInvitation(req.params.token as string) });
  },
);

// POST /api/auth/invitation/:token — sets the chosen password and opens the session
router.post(
  '/invitation/:token',
  signupLimiter,
  validate({ params: invitationTokenParam, body: z.object({ password: passwordSchema }) }),
  async (req, res) => {
    const { password } = req.body as { password: string };
    const user = await InvitationService.acceptInvitation(req.params.token as string, password);
    // Activating one's account is a login: nobody is asked to retype the password they have just chosen.
    await grantSession(user, req, res);
  },
);

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) throw unauthorized('User not found');
  res.json({ user: { ...(await toSessionUser(user)), twoFaEnabled: user.totpEnabledAt != null } });
});

export default router;
