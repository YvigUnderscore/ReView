// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import * as oidc from 'openid-client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { getOidcConfig, getOidcLogoUrl, isOidcReady, type OidcConfig } from '../lib/oidcConfig';
import {
  JWT_ALGORITHM,
  JWT_VERIFY_OPTIONS,
  signAccessToken,
  signRefreshToken,
  signTwoFaToken,
} from '../lib/jwt';
import { createSession } from '../lib/sessions';
import { logAudit } from '../services/AuditService';
import { logger } from '../lib/logger';
import { notFound } from '../lib/errors';
import { safeFetch } from '../lib/safeFetch';

/**
 * OIDC SSO (36.A): authorization code flow (Google by default). The state and nonce are carried by a
 * short-lived JWT in an httpOnly cookie (no server session before login).
 * SPA return via fragment (never sent to the server): `/login#sso=<access>&refresh=<r>`,
 * `#tfa=<tmpToken>` if the account has 2FA, `#ssoerr=<message>` on failure.
 */
const router = Router();

const COOKIE = 'oidc_state';
let discoveryCache: { key: string; config: oidc.Configuration; until: number } | null = null;

/**
 * The state cookie is signed with the same `JWT_SECRET` as the session tokens: it therefore takes the
 * algorithm declared once in `lib/jwt`, on BOTH sides. An invariant stated there but forgotten here
 * protects nothing: it is the most permissive verifier that decides, and this cookie carries the whole
 * CSRF protection of the login flow.
 */
const STATE_SIGN_OPTIONS: SignOptions = { algorithm: JWT_ALGORITHM, expiresIn: '10m' };
/** Content of the state cookie as it is PRESENTED: nothing guarantees its shape. */
type OidcStateClaims = { kind?: string; state?: string; nonce?: string };

const OIDC_TIMEOUT_MS = 10_000;
/** A discovery document or a JWKS is measured in kilobytes: 1 MiB is already generous. */
const OIDC_MAX_BYTES = 1024 * 1024;

/**
 * The issuer is an administration URL: the server fetches it itself, from the application network.
 * All of openid-client's requests (discovery, tokens, JWKS) therefore go through `safeFetch`: anti-SSRF
 * guard on the resolved address, timeout, bounded response. Redirects are followed (two at most)
 * because some providers normalize the trailing slash of the issuer, but each hop is re-checked.
 */
const oidcFetch: oidc.CustomFetch = (url, options) =>
  safeFetch(url, options, {
    timeoutMs: OIDC_TIMEOUT_MS,
    maxRedirects: 2,
    maxBytes: OIDC_MAX_BYTES,
  });

async function discovery(cfg: OidcConfig): Promise<oidc.Configuration> {
  const key = `${cfg.issuer}|${cfg.clientId}`;
  if (discoveryCache && discoveryCache.key === key && discoveryCache.until > Date.now()) {
    return discoveryCache.config;
  }
  const config = await oidc.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret, undefined, {
    [oidc.customFetch]: oidcFetch,
  });
  // Discovery does not always propagate the option: we re-attach it to the configuration, which is
  // then used for the code exchange and the JWKS read.
  config[oidc.customFetch] = oidcFetch;
  discoveryCache = { key, config, until: Date.now() + 10 * 60_000 };
  return config;
}

const redirectUri = (cfg: OidcConfig) => `${cfg.publicUrl}/api/auth/oidc/callback`;

async function readyConfig(): Promise<OidcConfig> {
  const cfg = await getOidcConfig();
  if (!isOidcReady(cfg)) throw notFound('SSO is not configured');
  return cfg;
}

/** Reads a cookie without a dependency (there is no cookie-parser in the app). */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// GET /api/auth/oidc/status — public: the front end shows (or not) the SSO button and its logo, and
// knows whether it must still offer the email and password form. `passwordLogin` is the EFFECTIVE
// state: it follows the same rule as the refusal on /api/auth/login, otherwise the login page would
// hide a form that the server still accepts (or the reverse).
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

// GET /api/auth/oidc/login — redirects to the provider (state and nonce in a signed cookie)
router.get('/login', async (_req, res) => {
  const cfg = await readyConfig();
  const config = await discovery(cfg);
  const state = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  res.cookie(COOKIE, jwt.sign({ kind: 'oidc', state, nonce }, env.JWT_SECRET, STATE_SIGN_OPTIONS), {
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

// GET /api/auth/oidc/callback — exchanges the code, logs in (or provisions) the account
router.get('/callback', async (req, res) => {
  const fail = (msg: string) => res.redirect(`/login#ssoerr=${encodeURIComponent(msg)}`);
  try {
    const cfg = await readyConfig();
    const raw = readCookie(req.headers.cookie, COOKIE);
    res.clearCookie(COOKIE, { path: '/api/auth/oidc' });
    if (!raw) return fail('Session SSO expirée, réessayez');
    let checks: { state: string; nonce: string };
    try {
      // Without `JWT_VERIFY_OPTIONS`, it is the party PRESENTING the cookie that chooses with which
      // algorithm it was signed (cf. `STATE_SIGN_OPTIONS` above).
      const p = jwt.verify(raw, env.JWT_SECRET, JWT_VERIFY_OPTIONS) as OidcStateClaims;
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
          // Random local password (SSO login; resettable by an admin).
          password: await bcrypt.hash(randomBytes(24).toString('hex'), 12),
          name: typeof claims?.name === 'string' ? claims.name.slice(0, 120) : null,
          role: 'ARTIST',
        },
      });
      logAudit({ userId: user.id, action: 'OIDC_PROVISION', entityType: 'User', entityId: user.id });
    }
    // Offboarding (A1-01): the identity still lives with the provider after the departure. Without this
    // refusal, SSO handed the leaver, even without a password, the access that the deactivation had just
    // withdrawn from them. Same message as "no account": from their point of view it is the same fact,
    // and nothing is said about the state of the account.
    if (user.disabledAt) return fail('Aucun compte pour cet email — contactez un admin');

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
