// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), create: vi.fn() }, auditLog: { create: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/sessions', () => ({
  createSession: vi.fn().mockResolvedValue('sid-1'),
  isSessionActive: vi.fn().mockResolvedValue(true),
  touchSession: vi.fn(),
  revokeSession: vi.fn().mockResolvedValue(true),
}));
vi.mock('../lib/oidcConfig', () => ({ isPasswordLoginBlocked: vi.fn().mockResolvedValue(false) }));
vi.mock('../lib/userView', () => ({ toSessionUser: vi.fn(async (u: { id: number }) => ({ id: u.id })) }));
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, role: 'ARTIST' } as Request['user'];
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import authRoutes from './auth.routes';
import authRefreshRoutes from './auth-refresh.routes';
import { errorHandler } from '../middleware/error';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import { createSession, isSessionActive, revokeSession, touchSession } from '../lib/sessions';
import { REFRESH_COOKIE } from '../lib/refreshCookie';
import { env } from '../config/env';

const app = express()
  .use(express.json())
  .use('/api/auth/refresh', authRefreshRoutes)
  .use('/api/auth', authRoutes)
  .use(errorHandler);

/** A refresh call as the page makes it: cookie presented by the browser, CSRF header set by the script. */
const refresh = (token?: string, method: 'post' | 'delete' = 'post') => {
  const r = request(app)[method]('/api/auth/refresh').set('X-Requested-With', 'ReView');
  return token ? r.set('Cookie', `${REFRESH_COOKIE}=${encodeURIComponent(token)}`) : r;
};

/** The refresh cookie set by a response, attributes included. */
const refreshCookieOf = (res: { headers: Record<string, unknown> }): string | undefined =>
  ([] as string[])
    .concat((res.headers['set-cookie'] as string[] | undefined) ?? [])
    .find((c) => c.startsWith(`${REFRESH_COOKIE}=`));

const sessionToken = (sid = 'sid-1') =>
  signRefreshToken({ id: user.id, email: user.email, role: 'ARTIST', sid });

// Cost 4: these tests measure the behavior, not the resistance of the hash.
const HASH = bcrypt.hashSync('Motdepasse1', 4);
const user = {
  id: 7,
  email: 'alice@studio.com',
  password: HASH,
  role: 'ARTIST',
  isService: false,
  totpEnabledAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(user);
  // `logAudit` detaches the write (`void create(...).catch(...)`): the double must return a promise,
  // otherwise it is the `.catch` that explodes in the middle of the route.
  db.auditLog.create.mockResolvedValue({});
});

/**
 * `/refresh` was the back door of the 36.B hardening: the middleware refused a legacy token without
 * `sid`, but this route manufactured a fresh session for it, so the bearer walked away with a perfectly
 * valid access token. Closing one without the other closes nothing.
 */
describe('POST /api/auth/refresh — no more session offered to a legacy token', () => {
  it('refuses a refresh without sid instead of opening a session for it', async () => {
    const legacy = sessionToken('a-retirer');
    // We remove the claim as a token from before phase 36 would.
    const { sid: _sid, ...sansSid } = jwt.verify(legacy, env.JWT_SECRET) as Record<string, unknown>;
    const forge = jwt.sign({ ...sansSid, kind: 'refresh' }, env.JWT_SECRET);

    const res = await refresh(forge);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_REVOKED' });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuses a refresh whose session has been revoked', async () => {
    vi.mocked(isSessionActive).mockResolvedValue(false);
    const res = await refresh(sessionToken('morte'));
    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('renews the access token and rotates the cookie when the session is alive', async () => {
    // `vi.clearAllMocks()` clears the history, not the implementation: without this reminder, the
    // `mockResolvedValue(false)` of the previous test would still hold.
    vi.mocked(isSessionActive).mockResolvedValue(true);

    const res = await refresh(sessionToken());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.any(String) });
    expect(touchSession).toHaveBeenCalledWith('sid-1');
    const cookie = refreshCookieOf(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/refresh/);
    expect(cookie).toMatch(/Expires=/);
  });

  it('refuses an access token presented in place of a refresh', async () => {
    const access = signAccessToken({ id: user.id, email: user.email, role: 'ARTIST', sid: 'sid-1' });
    const res = await refresh(access);
    expect(res.status).toBe(401);
  });

  it('refuses a disabled account and clears its cookie', async () => {
    db.user.findUnique.mockResolvedValue({ ...user, disabledAt: new Date() });
    const res = await refresh(sessionToken());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect(refreshCookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('POST /api/auth/refresh — the token is only read from its httpOnly cookie', () => {
  it('no cookie: 401, whatever the body says', async () => {
    const res = await refresh().send({ refreshToken: sessionToken() });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'NO_REFRESH_TOKEN' });
  });

  it('refuses a call without the X-Requested-With header (CSRF)', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${sessionToken()}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'CSRF_HEADER_REQUIRED' });
    expect(touchSession).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/auth/refresh — logout without an access token', () => {
  it("revokes the cookie's session and clears the cookie", async () => {
    const res = await refresh(sessionToken('sid-9'), 'delete');
    expect(res.status).toBe(204);
    expect(revokeSession).toHaveBeenCalledWith('sid-9', user.id);
    expect(refreshCookieOf(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('clears the cookie even when its token is unreadable', async () => {
    const res = await refresh('garbage', 'delete');
    expect(res.status).toBe(204);
    expect(revokeSession).not.toHaveBeenCalled();
    expect(refreshCookieOf(res)).toBeDefined();
  });
});

describe('POST /api/auth/login — the refresh token never reaches the page', () => {
  it('returns the access token in the body and the refresh token in its cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).not.toHaveProperty('refreshToken');
    const cookie = refreshCookieOf(res);
    expect(cookie).toMatch(/HttpOnly/i);
    const value = decodeURIComponent(cookie!.split(';')[0]!.split('=')[1]!);
    expect((jwt.verify(value, env.JWT_SECRET) as { kind?: string }).kind).toBe('refresh');
  });
});
