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
vi.mock('../middleware/auth', () => ({
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
 * Un `rvk_` vit jusqu'à 3650 jours et survit à la fermeture de l'onglet. Fabriqué depuis
 * un jeton d'accès volé, il transforme un vol de session passager en accès durable — que
 * « se déconnecter partout » ne soupçonne même pas. Le mot de passe est la seule chose que
 * l'attaquant n'a pas.
 */
describe('POST /api/auth/tokens — ré-authentification', () => {
  it('refuse la création sans mot de passe courant', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'] });
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(createPersonal).not.toHaveBeenCalled();
  });

  it('refuse un mot de passe faux', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'MauvaisMdp1' });
    expect(res.status).toBe(401);
    expect(createPersonal).not.toHaveBeenCalled();
  });

  it('crée le token quand le mot de passe est correct', async () => {
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'Motdepasse1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ token: 'rvk_secret' });
    expect(createPersonal).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'ferme' }));
  });

  // Anti-escalade : un token d'API ne fabrique pas de token, mot de passe ou non.
  it('refuse un porteur qui est lui-même un token d’API', async () => {
    actor.apiToken = { id: 3 };
    const res = await request(app)
      .post('/api/auth/tokens')
      .send({ name: 'ferme', scopes: ['read'], currentPassword: 'Motdepasse1' });
    expect(res.status).toBe(400);
    expect(createPersonal).not.toHaveBeenCalled();
  });
});
