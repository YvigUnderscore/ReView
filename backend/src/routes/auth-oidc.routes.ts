// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import * as oidc from 'openid-client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { getOidcConfig, getOidcLogoUrl, isOidcReady, type OidcConfig } from '../lib/oidcConfig';
import { signAccessToken, signRefreshToken, signTwoFaToken } from '../lib/jwt';
import { createSession } from '../lib/sessions';
import { logAudit } from '../services/AuditService';
import { logger } from '../lib/logger';
import { notFound } from '../lib/errors';

/**
 * SSO OIDC (36.A) — authorization code flow (Google par défaut). State + nonce sont
 * portés par un JWT court en cookie httpOnly (pas de session serveur avant login).
 * Retour SPA par fragment (jamais envoyé au serveur) : `/login#sso=<access>&refresh=<r>`,
 * `#tfa=<tmpToken>` si le compte a la 2FA, `#ssoerr=<message>` en échec.
 */
const router = Router();

const COOKIE = 'oidc_state';
let discoveryCache: { key: string; config: oidc.Configuration; until: number } | null = null;

async function discovery(cfg: OidcConfig): Promise<oidc.Configuration> {
  const key = `${cfg.issuer}|${cfg.clientId}`;
  if (discoveryCache && discoveryCache.key === key && discoveryCache.until > Date.now()) {
    return discoveryCache.config;
  }
  const config = await oidc.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);
  discoveryCache = { key, config, until: Date.now() + 10 * 60_000 };
  return config;
}

const redirectUri = (cfg: OidcConfig) => `${cfg.publicUrl}/api/auth/oidc/callback`;

async function readyConfig(): Promise<OidcConfig> {
  const cfg = await getOidcConfig();
  if (!isOidcReady(cfg)) throw notFound('SSO is not configured');
  return cfg;
}

/** Lit un cookie sans dépendance (pas de cookie-parser dans l'app). */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// GET /api/auth/oidc/status — public : le front affiche (ou non) le bouton SSO, son logo,
// et sait s'il doit encore proposer le formulaire email + mot de passe. `passwordLogin`
// est l'état EFFECTIF : il suit la même règle que le refus côté /api/auth/login, sans quoi
// la page de connexion cacherait un formulaire que le serveur accepte encore (ou l'inverse).
router.get('/status', async (_req, res) => {
  const cfg = await getOidcConfig();
  const ready = isOidcReady(cfg);
  res.json({
    enabled: ready,
    label: cfg.buttonLabel,
    logoUrl: ready ? await getOidcLogoUrl(cfg.logoKey) : null,
    passwordLogin: !(cfg.passwordLoginDisabled && ready),
  });
});

// GET /api/auth/oidc/login — redirige vers le fournisseur (state+nonce en cookie signé)
router.get('/login', async (_req, res) => {
  const cfg = await readyConfig();
  const config = await discovery(cfg);
  const state = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  res.cookie(COOKIE, jwt.sign({ kind: 'oidc', state, nonce }, env.JWT_SECRET, { expiresIn: '10m' }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.publicUrl.startsWith('https://'),
    maxAge: 10 * 60_000,
    path: '/api/auth/oidc',
  });
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(cfg),
    scope: 'openid email profile',
    state,
    nonce,
  });
  res.redirect(url.href);
});

// GET /api/auth/oidc/callback — échange le code, connecte (ou provisionne) le compte
router.get('/callback', async (req, res) => {
  const fail = (msg: string) => res.redirect(`/login#ssoerr=${encodeURIComponent(msg)}`);
  try {
    const cfg = await readyConfig();
    const raw = readCookie(req.headers.cookie, COOKIE);
    res.clearCookie(COOKIE, { path: '/api/auth/oidc' });
    if (!raw) return fail('Session SSO expirée, réessayez');
    let checks: { state: string; nonce: string };
    try {
      const p = jwt.verify(raw, env.JWT_SECRET) as { kind?: string; state?: string; nonce?: string };
      if (p.kind !== 'oidc' || !p.state || !p.nonce) return fail('Session SSO invalide');
      checks = { state: p.state, nonce: p.nonce };
    } catch {
      return fail('Session SSO expirée, réessayez');
    }

    const config = await discovery(cfg);
    const current = new URL(req.originalUrl, cfg.publicUrl);
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
    });
    const claims = tokens.claims();
    const email = typeof claims?.email === 'string' ? claims.email.toLowerCase() : null;
    if (!email || claims?.email_verified !== true) return fail('Email non vérifié chez le fournisseur');

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      if (!cfg.autoProvision) return fail('Aucun compte pour cet email — contactez un admin');
      user = await prisma.user.create({
        data: {
          email,
          // Mot de passe local aléatoire (connexion par SSO ; réinitialisable par un admin).
          password: await bcrypt.hash(randomBytes(24).toString('hex'), 12),
          name: typeof claims?.name === 'string' ? claims.name.slice(0, 120) : null,
          role: 'ARTIST',
        },
      });
      logAudit({ userId: user.id, action: 'OIDC_PROVISION', entityType: 'User', entityId: user.id });
    }

    if (user.totpEnabledAt) {
      return res.redirect(`/login#tfa=${encodeURIComponent(signTwoFaToken(user.id))}`);
    }
    const sid = await createSession(user.id, req);
    const payload = { id: user.id, email: user.email, role: user.role, sid };
    logAudit({ userId: user.id, action: 'OIDC_LOGIN', entityType: 'User', entityId: user.id });
    res.redirect(
      `/login#sso=${encodeURIComponent(signAccessToken(payload))}&refresh=${encodeURIComponent(signRefreshToken(payload))}`,
    );
  } catch (err) {
    logger.warn({ err }, '[oidc] callback en échec');
    fail('Connexion SSO échouée');
  }
});

export default router;
