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

/** Données de la dernière ligne d'audit écrite par la route. */
const lastAudit = (): Record<string, unknown> =>
  (db.auditLog.create.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data;

/**
 * A5-03 : ni la connexion réussie ni la connexion refusée ne laissaient de trace, alors que
 * `TWOFA_FAIL` et `OIDC_LOGIN` en laissent une. C'est pourtant la première ligne que l'on
 * cherche le jour où l'on soupçonne un compte volé ou un départ mal soldé.
 *
 * La trace ne doit rien apprendre à l'attaquant : même appel, même travail, adresse connue
 * ou non — et jamais le mot de passe présenté.
 *
 * Une adresse distincte par test : le frein par compte visé (10 tentatives / 15 min) est
 * partagé par tout le fichier, et sa mémoire ne se réinitialise pas entre deux `it`.
 */
describe('POST /api/auth/login — trace d’audit (A5-03)', () => {
  it('consigne LOGIN avec l’identifiant du compte quand la connexion aboutit', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-ok@studio.com', password: 'Motdepasse1' });

    expect(db.auditLog.create).toHaveBeenCalledOnce();
    expect(lastAudit()).toMatchObject({ userId: 7, action: 'LOGIN', entityType: 'User', entityId: 7 });
    expect(lastAudit().metadata).toMatchObject({ email: 'trace-ok@studio.com' });
  });

  it('consigne LOGIN_FAIL sans auteur quand l’adresse est inconnue', async () => {
    db.user.findUnique.mockResolvedValue(null);

    await request(app).post('/api/auth/login').send({ email: 'fantome@studio.com', password: 'Motdepasse1' });

    expect(lastAudit()).toMatchObject({ userId: null, action: 'LOGIN_FAIL', entityId: null });
    // L'adresse visée reste dans la trace : c'est elle qui montre une énumération en cours.
    expect(lastAudit().metadata).toMatchObject({ email: 'fantome@studio.com' });
  });

  it('consigne LOGIN_FAIL sur un mot de passe faux comme sur un compte désactivé', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-mdp@studio.com', password: 'MauvaisMdp1' });
    expect(lastAudit()).toMatchObject({ userId: 7, action: 'LOGIN_FAIL' });

    // A1-01 : le partant qui retape son mot de passe laisse désormais une trace nommée.
    db.user.findUnique.mockResolvedValue({ ...user, disabledAt: new Date() });
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-off@studio.com', password: 'Motdepasse1' });
    expect(lastAudit()).toMatchObject({ action: 'LOGIN_FAIL' });
  });

  it('n’écrit jamais le mot de passe présenté, ni son empreinte', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-mdp2@studio.com', password: 'Motdepasse1' });

    const written = JSON.stringify(db.auditLog.create.mock.calls);
    expect(written).not.toContain('Motdepasse1');
    expect(written).not.toContain(HASH);
  });

  it('ne fait pas attendre la réponse à l’écriture du journal', async () => {
    // Écriture qui ne se résout jamais : la connexion doit répondre malgré tout, sans quoi
    // une base lente introduirait un écart de temps mesurable sur le chemin d'authentification.
    db.auditLog.create.mockReturnValue(new Promise(() => {}));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'trace-lent@studio.com', password: 'Motdepasse1' });

    expect(res.status).toBe(200);
  });
});
