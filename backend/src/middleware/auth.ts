// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { getAuthUser } from '../lib/userCache';
import { isSessionActive } from '../lib/sessions';
import { authenticateApiToken, isApiTokenFormat } from '../lib/apiTokens';

/** `Authorization: Bearer <token>` — the scheme is required, its case is free. */
const BEARER = /^Bearer[ ]+(.+)$/i;

/**
 * Authenticates via JWT (`Authorization: Bearer` header) or via an API token `rvk_…`
 * (36.C — read/write scopes).
 *
 * ⚠ The token is read ONLY from the header. Historical support for `?token=` has been removed: a
 * URL travels through application logs, the front proxy's logs, browser history and the `Referer`
 * header, whereas a header goes nowhere. No caller depends on it any longer: the HLS player sets
 * its own `Authorization` (xhrSetup), the socket has its handshake, and `/metrics` reads its query
 * itself in `app.ts`. Restoring it would reopen the leak: add a header to the client, not a query
 * here.
 *
 * Keeps the v1 "zombie-token check": the existence of the user is re-verified in the DB and their
 * current role is reloaded (a token stays invalid if the account is deleted).
 * 36.B: every access JWT carries a `sid` and is only valid if its session is (effective revocation
 * within 30 s via the lib/sessions cache).
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = BEARER.exec(req.headers['authorization'] ?? '')?.[1]?.trim();

  if (!token) {
    res.status(401).json({ error: 'Not authenticated', code: 'TOKEN_REQUIRED' });
    return;
  }

  // API token (36.C): lookup by hash + scopes (write refused without a write scope).
  if (isApiTokenFormat(token)) {
    await authenticateApiToken(req, res, next, token);
    return;
  }

  // All of the app's tokens (access, refresh, 2fa, client share session, OIDC state) are signed
  // with the same JWT_SECRET: we filter by allowlist rather than by denylist. Only an access token
  // (no `kind`, carrying a numeric id) authenticates a request: a new token type added tomorrow is
  // thus refused by default.
  const payload = verifyToken(token);
  if (!payload || payload.kind !== undefined || typeof payload.id !== 'number') {
    res.status(403).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
    return;
  }

  // Invariant 36.B: an access token ALWAYS carries the session that makes it revocable. Without
  // `sid`, nothing can invalidate it, neither a logout, nor a password change, nor an admin's
  // offboarding: it would live until its natural expiry. Such a token (issued before phase 36, or
  // forged by removing the claim) is therefore refused exactly like a token whose session is dead.
  // The transitional grace period is closed.
  if (!payload.sid || !(await isSessionActive(payload.sid))) {
    res.status(401).json({ error: 'Session revoked or expired', code: 'SESSION_REVOKED' });
    return;
  }

  // Read cached for 30 s (B3): without it, every API call replayed this query, i.e. twenty to
  // forty per navigation.
  const dbUser = await getAuthUser(payload.id);

  if (!dbUser) {
    res.status(401).json({ error: 'User not found', code: 'USER_GONE' });
    return;
  }

  // Offboarding (A1-01): deactivating an account revokes its sessions, but nothing prevented
  // reopening one. The lock is here AND at token issuance; this one closes the thirty-second window
  // of the identity cache for tokens already in circulation.
  if (dbUser.disabledAt) {
    res.status(401).json({ error: 'Account disabled', code: 'ACCOUNT_DISABLED' });
    return;
  }

  // `disabledAt` does not travel any further: `req.user` is the identity, not the account record.
  req.user = { id: dbUser.id, email: dbUser.email, role: dbUser.role };
  req.sessionId = payload.sid;
  next();
};
