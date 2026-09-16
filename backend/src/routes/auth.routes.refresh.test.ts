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

// Coût 4 : ces tests mesurent le comportement, pas la résistance du hash.
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
  // `logAudit` détache l'écriture (`void create(...).catch(...)`) : le double doit rendre
  // une promesse, sinon c'est le `.catch` qui explose au milieu de la route.
  db.auditLog.create.mockResolvedValue({});
});

/**
 * `/refresh` était la porte de derrière du durcissement 36.B : le middleware refusait un
 * jeton hérité sans `sid`, mais cette route lui fabriquait une session neuve — le porteur
 * repartait donc avec un jeton d'accès parfaitement valide. Fermer l'un sans l'autre ne
 * ferme rien.
 */
describe('POST /api/auth/refresh — plus de session offerte à un jeton hérité', () => {
  it('refuse un refresh sans sid au lieu de lui ouvrir une session', async () => {
    const legacy = signRefreshToken({
      id: user.id,
      email: user.email,
      role: 'ARTIST',
      sid: 'a-retirer',
    });
    // On retire la claim comme le ferait un jeton d'avant la phase 36.
    const { sid: _sid, ...sansSid } = jwt.verify(legacy, env.JWT_SECRET) as Record<string, unknown>;
    const forge = jwt.sign({ ...sansSid, kind: 'refresh' }, env.JWT_SECRET);

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: forge });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'SESSION_REVOKED' });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('refuse un refresh dont la session a été révoquée', async () => {
    vi.mocked(isSessionActive).mockResolvedValue(false);
    const token = signRefreshToken({ id: user.id, email: user.email, role: 'ARTIST', sid: 'morte' });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });

    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('renouvelle le couple de jetons quand la session est vivante', async () => {
    // `vi.clearAllMocks()` efface l'historique, pas l'implémentation : sans ce rappel, le
    // `mockResolvedValue(false)` du test précédent tiendrait encore.
    vi.mocked(isSessionActive).mockResolvedValue(true);
    const token = signRefreshToken({ id: user.id, email: user.email, role: 'ARTIST', sid: 'sid-1' });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('refreshToken');
    expect(touchSession).toHaveBeenCalledWith('sid-1');
  });

  it('refuse un jeton d’accès présenté à la place d’un refresh', async () => {
    const access = signAccessToken({ id: user.id, email: user.email, role: 'ARTIST', sid: 'sid-1' });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: access });

    expect(res.status).toBe(401);
  });
});
