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
}));
vi.mock('../lib/oidcConfig', () => ({ isPasswordLoginBlocked: vi.fn().mockResolvedValue(false) }));
vi.mock('../lib/userView', () => ({ toSessionUser: vi.fn(async (u: { id: number }) => ({ id: u.id })) }));
vi.mock('../middleware/auth', () => ({
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
import { errorHandler } from '../middleware/error';
import { signAccessToken, signRefreshToken } from '../lib/jwt';
import { createSession, isSessionActive, touchSession } from '../lib/sessions';
import { env } from '../config/env';

const app = express().use(express.json()).use('/api/auth', authRoutes).use(errorHandler);

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
    const legacy = signRefreshToken({
      id: user.id,
      email: user.email,
      role: 'ARTIST',
      sid: 'a-retirer',
    });
    // We remove the claim as a token from before phase 36 would.
    const { sid: _sid, ...sansSid } = jwt.verify(legacy, env.JWT_SECRET) as Record<string, unknown>;
    const forge = jwt.sign({ ...sansSid, kind: 'refresh' }, env.JWT_SECRET);

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: forge });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_REVOKED' });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuses a refresh whose session has been revoked', async () => {
    vi.mocked(isSessionActive).mockResolvedValue(false);
    const token = signRefreshToken({ id: user.id, email: user.email, role: 'ARTIST', sid: 'morte' });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });

    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('renews the token pair when the session is alive', async () => {
    // `vi.clearAllMocks()` clears the history, not the implementation: without this reminder, the
    // `mockResolvedValue(false)` of the previous test would still hold.
    vi.mocked(isSessionActive).mockResolvedValue(true);
    const token = signRefreshToken({ id: user.id, email: user.email, role: 'ARTIST', sid: 'sid-1' });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(touchSession).toHaveBeenCalledWith('sid-1');
  });

  it('refuses an access token presented in place of a refresh', async () => {
    const access = signAccessToken({ id: user.id, email: user.email, role: 'ARTIST', sid: 'sid-1' });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: access });

    expect(res.status).toBe(401);
  });
});
