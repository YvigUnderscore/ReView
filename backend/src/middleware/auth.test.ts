// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock('../lib/sessions', () => ({ isSessionActive: vi.fn().mockResolvedValue(true) }));

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from './auth';
import { prisma } from '../lib/prisma';
import { __testing as userCache } from '../lib/userCache';
import { isSessionActive } from '../lib/sessions';
import { signAccessToken, signRefreshToken, signTwoFaToken } from '../lib/jwt';
import { signShareSession } from '../lib/shareAccess';
import { env } from '../config/env';

const dbUser = { id: 7, email: 'artist@studio.com', role: 'ARTIST' as const };

const run = async (token: string) => {
  const req = { headers: { authorization: `Bearer ${token}` }, query: {} } as unknown as Request;
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn() as unknown as NextFunction;
  await authenticate(req, res as unknown as Response, next);
  return { req, res, next };
};

beforeEach(() => {
  // The identity is cached for 30 s (B3): without a purge, a test would inherit the user
  // resolved by the previous one.
  userCache.cache.clear();
  vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
  vi.mocked(isSessionActive).mockResolvedValue(true);
});

describe('authenticate — allowlist of token types', () => {
  it('accepts an access token', async () => {
    const { req, next } = await run(signAccessToken({ ...dbUser, sid: 'abc' }));
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(dbUser);
  });

  // All of the app's tokens are signed with the same JWT_SECRET. Each of these is a valid
  // signature: only the `kind` distinguishes them from an access token.
  it('rejects a refresh token', async () => {
    const { res, next } = await run(signRefreshToken({ ...dbUser, sid: 'abc' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  // The 2FA token is issued after the password but BEFORE the TOTP code: accepting it would
  // reduce the second factor to a formality.
  it('rejects an intermediate 2FA token', async () => {
    const { res, next } = await run(signTwoFaToken(dbUser.id));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects a client share session', async () => {
    const { res, next } = await run(signShareSession(42));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects an OIDC state token', async () => {
    const token = jwt.sign({ kind: 'oidc', state: 's', nonce: 'n' }, env.JWT_SECRET);
    const { res, next } = await run(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  // An unknown `kind` (a token type added later) must be refused by default.
  it('rejects any unknown kind', async () => {
    const token = jwt.sign({ id: 7, email: dbUser.email, role: 'ADMIN', kind: 'futur' }, env.JWT_SECRET);
    const { res, next } = await run(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('rejects a token without a numeric id', async () => {
    const token = jwt.sign({ email: dbUser.email, role: 'ADMIN' }, env.JWT_SECRET);
    const { res, next } = await run(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

/**
 * A URL travels through application logs, the front proxy's logs, browser history and the
 * `Referer` header; a header goes nowhere. So support for `?token=` was removed: no caller
 * depended on it any longer (the HLS player sets its own `Authorization`, the socket has its
 * handshake, and `/metrics` reads its query itself in `app.ts`).
 */
describe('authenticate — the token is only read from the header', () => {
  const runRaw = async (headers: Record<string, string>, query: Record<string, string> = {}) => {
    const req = { headers, query } as unknown as Request;
    const res = {
      statusCode: 0,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };
    const next = vi.fn() as unknown as NextFunction;
    await authenticate(req, res as unknown as Response, next);
    return { req, res, next };
  };

  it('rejects a valid access token presented in the query', async () => {
    const { res, next } = await runRaw({}, { token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('ignores the query even when the header is absent and the token is correct', async () => {
    const { req } = await runRaw({}, { token: signAccessToken({ ...dbUser, sid: 'abc' }) });
    expect(req.user).toBeUndefined();
  });

  it('requires the Bearer scheme (its case is free)', async () => {
    const token = signAccessToken({ ...dbUser, sid: 'abc' });
    expect((await runRaw({ authorization: `bearer ${token}` })).next).toHaveBeenCalled();
    const { res, next } = await runRaw({ authorization: token });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('authenticate — session and account existence', () => {
  it('rejects when the session has been revoked', async () => {
    vi.mocked(isSessionActive).mockResolvedValue(false);
    const { res, next } = await run(signAccessToken({ ...dbUser, sid: 'revoked' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token whose account no longer exists', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const { res, next } = await run(signAccessToken({ ...dbUser, sid: 'abc' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  /**
   * A1-01: the identity cache did not even SELECT the column, so the middleware had nothing to
   * test, and a token issued before deactivation lived on. This is the second lock: the one at
   * issuance does not cover tokens already in circulation.
   */
  it('rejects a deactivated account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...dbUser,
      disabledAt: new Date(),
    } as never);
    const { res, next } = await run(signAccessToken({ ...dbUser, sid: 'abc' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  // `req.user` is the identity, not the record: the deactivation date does not have to travel
  // in the responses that copy the authenticated user.
  it('does not propagate disabledAt into req.user', async () => {
    const { req } = await run(signAccessToken({ ...dbUser, sid: 'abc' }));
    expect(req.user).not.toHaveProperty('disabledAt');
  });

  // End of the transitional grace period of 36.B. A token without `sid` (issued before phase 36,
  // or forged by removing the claim) has no session to revoke: it would survive a logout, a
  // password change and an offboarding. It is therefore refused just like a token whose session
  // is dead.
  it('rejects a legacy token without sid, even if perfectly signed', async () => {
    const legacy = jwt.sign({ id: dbUser.id, email: dbUser.email, role: dbUser.role }, env.JWT_SECRET);
    const { res, next } = await run(legacy);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_REVOKED' });
  });

  // The session need not be consulted for a token that designates none: the refusal is
  // immediate, without a Redis round trip.
  it('does not consult the session for a token without sid', async () => {
    const legacy = jwt.sign({ id: dbUser.id, email: dbUser.email, role: dbUser.role }, env.JWT_SECRET);
    // The file's `beforeEach` does not purge the call history: we do it here,
    // otherwise we would count the calls of the previous tests.
    vi.mocked(isSessionActive).mockClear();
    await run(legacy);
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  // The role is re-read from the database: a token issued before a demotion must not
  // keep carrying the old role.
  it('reloads the current role rather than the token's', async () => {
    const stale = signAccessToken({ id: 7, email: dbUser.email, role: 'ADMIN', sid: 'abc' });
    const { req } = await run(stale);
    expect(req.user?.role).toBe('ARTIST');
  });
});
