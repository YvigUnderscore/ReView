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
 * Hash bcrypt (coût 12) d'une valeur aléatoire perdue : aucun mot de passe ne le vérifie.
 *
 * Il sert à faire travailler bcrypt même quand l'adresse ne correspond à aucun compte.
 * Sans lui, la réponse revient ~100 ms plus tôt dans ce cas : de quoi énumérer à distance
 * les adresses du studio sans jamais deviner un mot de passe.
 */
const ABSENT_ACCOUNT_HASH = '$2b$12$FZqqqvbZMoTW4t0AxtCNBOlpsEVwaNdSPZWu1.p/Q2tXt/kj3SMp2';

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().max(128),
});

// Deux freins distincts, non un budget partagé : l'IP protège le service et reste large (tout un
// studio sort par une seule adresse publique), le COMPTE protège le mot de passe — cent machines
// complices restent bornées sur l'adresse visée. Inscription et invitation ont leur propre espace.
const loginIpLimiter = rateLimit({ name: 'auth-login-ip', windowMs: 15 * 60_000, max: 300 });
const signupLimiter = rateLimit({ name: 'auth-signup', windowMs: 15 * 60_000, max: 50 });
const loginAccountLimiter = rateLimit({
  name: 'auth-login-account',
  windowMs: 15 * 60_000,
  max: 10,
  keyGenerator: targetAccountRateKey,
});

/**
 * Mode « SSO seul » (studio) : le mot de passe n'est plus une porte d'entrée.
 *
 * Le refus vaut aussi pour l'inscription libre : un compte créé avec un mot de passe
 * inutilisable n'est pas un compte, c'est un piège — et il réserve l'email d'un
 * collaborateur avant sa première connexion SSO.
 */
async function refusePasswordAuth(): Promise<void> {
  if (await isPasswordLoginBlocked()) {
    throw forbidden('Password sign-in is off — use SSO', 'PASSWORD_LOGIN_DISABLED');
  }
}

// Offboarding (A1-01) : révoquer les sessions d'un partant ne servait à rien tant qu'il lui
// suffisait de retaper son mot de passe. Le refus est nommé sans rien apprendre — on n'y arrive
// qu'avec le bon mot de passe.
const refuseIfDisabled = (user: { disabledAt: Date | null }): void => {
  if (user.disabledAt) throw unauthorized('Account disabled', 'ACCOUNT_DISABLED');
};

/** Ouvre la session et rend le couple de jetons — réponse commune à `/login` et à l'activation. */
async function grantSession(user: RawSessionUser, req: Request, res: Response): Promise<void> {
  const sid = await createSession(user.id, req);
  const payload = { id: user.id, email: user.email, role: user.role, sid };
  const token = signAccessToken(payload);
  res.json({ token, refreshToken: signRefreshToken(payload), user: await toSessionUser(user) });
}

// POST /api/auth/register — crée un artiste. Fermé par défaut (ALLOW_SELF_REGISTRATION) :
// sinon n'importe qui obtient un compte authentifié sur l'instance, et peut réserver
// l'email d'un collaborateur avant sa première connexion SSO.
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

// POST /api/auth/login — session révocable (36.B) ; si 2FA actif, renvoie un jeton
// intermédiaire à échanger via /api/auth/2fa/verify (36.A). Le frein par compte est posé
// APRÈS la validation Zod : sans corps parsé, sa clé serait ce que l'appelant a bien voulu.
const loginGuards = [loginIpLimiter, validate({ body: credentialsSchema }), loginAccountLimiter];
router.post('/login', loginGuards, async (req: Request, res: Response) => {
  await refusePasswordAuth();
  const { password } = req.body as { password: string };
  // Toutes les écritures normalisent l'adresse (inscription, invitation, installation,
  // provisionnement OIDC). La chercher telle qu'elle est tapée rendait « Alice@Studio.com »
  // inatteignable pour un compte enregistré « alice@studio.com ».
  const email = normalizeEmail((req.body as { email: string }).email);
  const user = await prisma.user.findUnique({ where: { email } });
  // La comparaison a lieu même sans compte (hash factice) : c'est ce qui rend le refus
  // aussi lent qu'un mot de passe faux, donc muet sur l'existence de l'adresse.
  const passwordOk = await bcrypt.compare(password, user?.password ?? ABSENT_ACCOUNT_HASH);
  // Un compte de service (API v1) n'existe que pour porter les écritures d'un token
  // machine : il ne se connecte jamais, même si son mot de passe aléatoire fuitait.
  const granted = !!user && passwordOk && !user.isService && !user.disabledAt;
  // A5-03 : le verdict est consigné avant d'être rendu, refus compris — c'est la première
  // ligne que l'on cherche après un vol de compte. Appel identique dans les deux branches,
  // écriture non attendue : aucun écart de temps ne trahit l'existence de l'adresse.
  logLoginAttempt({ user, granted, email, ip: req.ip });
  if (!user || !passwordOk || user.isService) throw unauthorized('Invalid credentials', 'BAD_CREDENTIALS');
  refuseIfDisabled(user);
  if (user.totpEnabledAt) {
    res.json({ requires2fa: true, tmpToken: signTwoFaToken(user.id) });
    return;
  }
  await grantSession(user, req, res);
});

// POST /api/auth/refresh — exige une session active.
//
// ⚠ Un refresh sans `sid` est REFUSÉ, il n'obtient pas de session neuve. La « migration
// transparente » qui en fabriquait une était la porte de derrière du correctif 36.B :
// refermer `middleware/auth` ne sert à rien si le jeton legacy que l'on vient d'écarter
// suffit à repartir avec un jeton d'accès parfaitement valide. Le porteur se reconnecte.
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

// ── Invitation d'un nouveau membre (Phase 47) ────────────────────────────────
// Routes publiques : le porteur du lien n'a, par définition, pas encore de session.

const invitationTokenParam = z.object({ token: z.string().min(20).max(128) });

// GET /api/auth/invitation/:token — aperçu affiché sur la page d'activation
router.get(
  '/invitation/:token',
  signupLimiter,
  validate({ params: invitationTokenParam }),
  async (req, res) => {
    res.json({ invitation: await InvitationService.describeInvitation(req.params.token as string) });
  },
);

// POST /api/auth/invitation/:token — pose le mot de passe choisi et ouvre la session
router.post(
  '/invitation/:token',
  signupLimiter,
  validate({ params: invitationTokenParam, body: z.object({ password: passwordSchema }) }),
  async (req, res) => {
    const { password } = req.body as { password: string };
    const user = await InvitationService.acceptInvitation(req.params.token as string, password);
    // Activer son compte vaut connexion : personne ne demande de retaper le mot de passe
    // qu'on vient de choisir.
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
