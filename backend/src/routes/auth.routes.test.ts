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
import authRoutes from './auth.routes';
import { errorHandler } from '../middleware/error';
import { createSession } from '../lib/sessions';

const app = express().use(express.json()).use('/api/auth', authRoutes).use(errorHandler);

// Cost 4: these tests measure behavior, not the resistance of the hash.
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
 * All writes normalize the address (sign-up, invitation, setup, OIDC provisioning). Login, however,
 * looked up the raw value of the form: a person retyping their address as it had been communicated to
 * them, capital letter included, got "invalid credentials" on an existing account.
 */
describe('POST /api/auth/login — address normalization', () => {
  it('finds the account when the address is typed with capital letters', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'Alice@Studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(200);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alice@studio.com' } });
  });
});

/**
 * The time gap between "unknown address" (no bcrypt at all) and "wrong password" (about 100 ms of
 * bcrypt) enumerates the studio's addresses remotely, without ever guessing a password.
 */
describe('POST /api/auth/login — no account enumeration', () => {
  it('still compares a hash when the address is unknown', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    db.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('returns the same refusal as for a wrong password', async () => {
    db.user.findUnique.mockResolvedValue(null);
    const absent = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@studio.com', password: 'Motdepasse1' })
      .then((r) => r.body as { error: string; code: string });
    db.user.findUnique.mockResolvedValue(user);
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'MauvaisMdp1' })
      .then((r) => r.body as { error: string; code: string });
    expect(absent).toEqual(wrong);
    expect(absent.code).toBe('BAD_CREDENTIALS');
  });

  // A service account carries the writes of a machine token: it never logs in.
  it('rejects a service account, even with the correct password', async () => {
    db.user.findUnique.mockResolvedValue({ ...user, isService: true });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(401);
  });

  it('lets a correct password in', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  /**
   * A1-01: `DELETE /api/users/:id` without `?hard=true` is the documented offboarding path. It does
   * revoke sessions and tokens, but nothing prevented the leaver from retyping the password they still
   * know and walking away again with a fresh token pair.
   */
  it('rejects a deactivated account, even with the correct password', async () => {
    db.user.findUnique.mockResolvedValue({ ...user, disabledAt: new Date() });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe('ACCOUNT_DISABLED');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('switches to the second factor without issuing an access token', async () => {
    db.user.findUnique.mockResolvedValue({ ...user, totpEnabledAt: new Date() });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requires2fa: true });
    expect(res.body).not.toHaveProperty('token');
  });
});
