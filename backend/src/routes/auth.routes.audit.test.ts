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
import authRoutes from './auth.routes';
import { errorHandler } from '../middleware/error';

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

/** Data of the last audit line written by the route. */
const lastAudit = (): Record<string, unknown> =>
  (db.auditLog.create.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;

/**
 * A5-03: neither a successful login nor a refused one left a trace, whereas `TWOFA_FAIL` and
 * `OIDC_LOGIN` leave one. Yet it is the first line one looks for on the day a stolen account or a
 * badly settled departure is suspected.
 *
 * The trace must teach the attacker nothing: same call, same work, address known or not, and never
 * the password presented.
 *
 * A distinct address per test: the per-target-account brake (10 attempts / 15 min) is shared by the
 * whole file, and its memory does not reset between two `it`.
 */
describe('POST /api/auth/login — audit trail (A5-03)', () => {
  it('records LOGIN with the account identifier when the login succeeds', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-ok@studio.com', password: 'Motdepasse1' });

    expect(db.auditLog.create).toHaveBeenCalledOnce();
    expect(lastAudit()).toMatchObject({ userId: 7, action: 'LOGIN', entityType: 'User', entityId: 7 });
    expect(lastAudit().metadata).toMatchObject({ email: 'trace-ok@studio.com' });
  });

  it('records LOGIN_FAIL without an author when the address is unknown', async () => {
    db.user.findUnique.mockResolvedValue(null);

    await request(app).post('/api/auth/login').send({ email: 'fantome@studio.com', password: 'Motdepasse1' });

    expect(lastAudit()).toMatchObject({ userId: null, action: 'LOGIN_FAIL', entityId: null });
    // The targeted address stays in the trace: it is what shows an enumeration in progress.
    expect(lastAudit().metadata).toMatchObject({ email: 'fantome@studio.com' });
  });

  it('records LOGIN_FAIL for a wrong password as well as for a deactivated account', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-mdp@studio.com', password: 'MauvaisMdp1' });
    expect(lastAudit()).toMatchObject({ userId: 7, action: 'LOGIN_FAIL' });

    // A1-01: the leaver who retypes their password now leaves a named trace.
    db.user.findUnique.mockResolvedValue({ ...user, disabledAt: new Date() });
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-off@studio.com', password: 'Motdepasse1' });
    expect(lastAudit()).toMatchObject({ action: 'LOGIN_FAIL' });
  });

  it('never writes the password presented, nor its hash', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-mdp2@studio.com', password: 'Motdepasse1' });

    const written = JSON.stringify(db.auditLog.create.mock.calls);
    expect(written).not.toContain('Motdepasse1');
    expect(written).not.toContain(HASH);
  });

  it('does not make the response wait for the log write', async () => {
    // A write that never resolves: the login must still respond, otherwise a slow database would
    // introduce a measurable timing gap on the authentication path.
    db.auditLog.create.mockReturnValue(new Promise(() => {}));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-lent@studio.com', password: 'Motdepasse1' });

    expect(res.status).toBe(200);
  });
});
