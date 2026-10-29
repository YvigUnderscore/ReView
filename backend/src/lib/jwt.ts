// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '@prisma/client';

/**
 * Payload SIGNED into a session token (access and refresh).
 *
 * ⚠ `sid` is mandatory, and it is a security invariant, not a convenience: the session is the ONLY anchor of a
 * revocation. A token without `sid` cannot be invalidated by any sign-out, password change or admin offboarding —
 * it would remain valid until its natural expiry. Every issuer therefore creates the session
 * (`lib/sessions.createSession`) BEFORE signing.
 */
export interface JwtPayload {
  id: number;
  email: string;
  role: Role;
  /** Login session (36.B): what makes the token revocable. */
  sid: string;
}

/**
 * Payload as it comes out of a token PRESENTED by a client.
 *
 * Nothing guarantees it carries a `sid`: tokens issued before phase 36 have none, and a client presents what it
 * wants. The type says so instead of hiding it — `middleware/auth` closes the case (401).
 */
export type VerifiedJwtPayload = Omit<JwtPayload, 'sid'> & { sid?: string; kind?: string };

/**
 * ⚠ The algorithm is fixed on BOTH sides, and in particular at verification.
 *
 * Without `algorithms`, `jwt.verify` accepts the algorithm announced by the token's header — that is, by whoever
 * presents it. The shared secret would then become a usable HMAC public key if an asymmetric variant were ever
 * introduced, and the accepted algorithm list would depend on the library version rather than on us. It is
 * therefore declared explicitly, here and only once.
 *
 * Both constants are EXPORTED because `JWT_SECRET` also signs auxiliary tokens outside this module: client sharing
 * session (`lib/shareAccess`), OIDC state (`routes/auth-oidc.routes`). An invariant stated here but forgotten
 * elsewhere protects nothing — the most permissive verifier decides. Every issuer of the same secret therefore
 * reuses these constants rather than redeclaring them.
 */
export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_VERIFY_OPTIONS: VerifyOptions = { algorithms: [JWT_ALGORITHM] };

export const signAccessToken = (payload: JwtPayload): string =>
  jwt.sign(payload, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);

export const signRefreshToken = (payload: JwtPayload): string =>
  jwt.sign({ ...payload, kind: 'refresh' }, env.JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);

export const verifyToken = (token: string): VerifiedJwtPayload | null => {
  try {
    return jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS) as VerifiedJwtPayload;
  } catch {
    return null;
  }
};

/** Intermediate 2FA token (36.A): issued after a correct password, before the TOTP code. */
export const signTwoFaToken = (userId: number): string =>
  jwt.sign({ id: userId, kind: '2fa' }, env.JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: '5m' });

export const verifyTwoFaToken = (token: string): number | null => {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTIONS) as { id?: number; kind?: string };
    return p.kind === '2fa' && typeof p.id === 'number' ? p.id : null;
  } catch {
    return null;
  }
};
