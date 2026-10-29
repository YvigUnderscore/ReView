// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';
import { ignoreFailure } from './ignoreFailure';

/**
 * API tokens (36.C, extended by API v1): `rvk_<40 hex>`, stored hashed (sha256).
 * Carried in `Authorization: Bearer` like a JWT; the middleware recognises them by prefix.
 *
 * Two kinds:
 *  - PERSONAL: acts on behalf of its owner, with the owner's role;
 *  - SERVICE: backed by a service account (`User.isService`, no interactive login), optionally
 *    scoped to one project.
 *
 * Scopes are fine-grained (`versions:write`...) and checked route by route by `middleware/scope`.
 * The coarse guard below stays in place for the internal `/api` API, which is not annotated per
 * domain: it accepts a write only if the token carries at least one write scope.
 */

export const API_TOKEN_PREFIX = 'rvk_';
/** Legacy scopes, kept for tokens issued before fine scopes. */
export const API_SCOPES = ['read', 'write'] as const;

export const isApiTokenFormat = (token: string): boolean => token.startsWith(API_TOKEN_PREFIX);

export const hashApiToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Generates a plaintext token (shown only once) and its storage hash. */
export function generateApiToken(): { token: string; tokenHash: string } {
  const token = API_TOKEN_PREFIX + randomBytes(20).toString('hex');
  return { token, tokenHash: hashApiToken(token) };
}

/** Is an HTTP method a write (requires a write scope)? */
export const isWriteMethod = (method: string): boolean =>
  !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

/** Does the token carry any write right (legacy `write`, `*:write`, `admin`)? */
export const grantsAnyWrite = (scopes: readonly string[]): boolean =>
  scopes.some((s) => s === 'write' || s === 'admin' || s.endsWith(':write'));

// lastUsedAt: throttled update (at most one write per minute per token).
const lastTouched = new Map<number, number>();

/** Authenticates a request carrying an API token (called by middleware/auth). */
export async function authenticateApiToken(
  req: Request,
  res: Response,
  next: NextFunction,
  token: string,
): Promise<void> {
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashApiToken(token) },
    select: {
      id: true,
      scopes: true,
      revokedAt: true,
      expiresAt: true,
      projectId: true,
      kind: true,
      user: { select: { id: true, email: true, role: true, disabledAt: true } },
    },
  });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) {
    res.status(403).json({ error: "Token d'API invalide ou révoqué", code: 'API_TOKEN_INVALID' });
    return;
  }
  // Offboarding (A1-01): disabling revokes existing tokens, but a token issued (or re-enabled)
  // another way must not hand control back to a departed account. The gate closes on the account
  // state, not on the revocation history.
  if (row.user.disabledAt) {
    res.status(401).json({ error: 'Account disabled', code: 'ACCOUNT_DISABLED' });
    return;
  }
  if (isWriteMethod(req.method) && !grantsAnyWrite(row.scopes)) {
    res.status(403).json({ error: 'Scope write requis', code: 'SCOPE_WRITE_REQUIRED' });
    return;
  }
  const last = lastTouched.get(row.id) ?? 0;
  if (Date.now() - last > 60_000) {
    lastTouched.set(row.id, Date.now());
    void prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(ignoreFailure('API token lastUsedAt update failed', { tokenId: row.id }));
  }
  req.user = { id: row.user.id, email: row.user.email, role: row.user.role };
  req.apiToken = {
    id: row.id,
    scopes: row.scopes,
    projectId: row.projectId ?? undefined,
    kind: row.kind,
  };
  next();
}
