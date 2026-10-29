// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { db, actor, createPersonal } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() }, apiToken: { findMany: vi.fn(), updateMany: vi.fn() } },
  actor: { current: { id: 7, role: 'ARTIST' }, apiToken: undefined as { id: number } | undefined },
  createPersonal: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../services/ApiTokenService', () => ({
  createPersonal,
  tokenSelect: {},
}));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/sessions', () => ({ revokeSession: vi.fn().mockResolvedValue(true) }));
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = actor.current as Request['user'];
    req.apiToken = actor.apiToken as Request['apiToken'];
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import authSecurityRoutes from './auth-security.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/auth', authSecurityRoutes).use(errorHandler);

const HASH = bcrypt.hashSync('Motdepasse1', 4);

beforeEach(() => {
  vi.clearAllMocks();
  actor.current = { id: 7, role: 'ARTIST' };
  actor.apiToken = undefined;
  db.user.findUnique.mockResolvedValue({ id: 7, password: HASH });
  createPersonal.mockResolvedValue({ token: 'rvk_secret', apiToken: { id: 1 } });
});

/**
 * An `rvk_` lives for up to 3650 days and survives closing the tab. Forged from a stolen access token,
 * it turns a passing session theft into durable access, which "log out everywhere" does not even
 * suspect. The password is the only thing the attacker does not have.
 */
describe('POST /api/auth/tokens — re-authentication', () => {
  it('refuses creation without the current password', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'] });
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(createPersonal).not.toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'MauvaisMdp1' });
    expect(res.status).toBe(401);
    expect(createPersonal).not.toHaveBeenCalled();
  });

  it('creates the token when the password is correct', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'Motdepasse1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ token: 'rvk_secret' });
    expect(createPersonal).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'ferme' }));
  });

  // Anti-escalation: an API token does not mint tokens, password or not.
  it('refuses a bearer that is itself an API token', async () => {
    actor.apiToken = { id: 3 };
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'Motdepasse1' });
    expect(res.status).toBe(400);
    expect(createPersonal).not.toHaveBeenCalled();
  });
});
