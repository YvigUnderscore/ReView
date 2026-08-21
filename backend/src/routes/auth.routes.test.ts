// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), create: vi.fn() } },
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
});

/**
 * Toutes les écritures normalisent l'adresse (inscription, invitation, installation,
 * provisionnement OIDC). La connexion, elle, cherchait la valeur brute du formulaire :
 * la personne qui retapait son adresse telle qu'on la lui avait communiquée, avec sa
 * majuscule, recevait « identifiants invalides » sur un compte pourtant existant.
 */
describe('POST /api/auth/login — normalisation de l’adresse', () => {
  it('retrouve le compte quand l’adresse est tapée avec des majuscules', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'Alice@Studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(200);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alice@studio.com' } });
  });
});

/**
 * L'écart de temps entre « adresse inconnue » (aucun bcrypt) et « mot de passe faux »
 * (~100 ms de bcrypt) énumère les adresses du studio à distance, sans jamais deviner un
 * mot de passe.
 */
describe('POST /api/auth/login — pas d’énumération de comptes', () => {
  it('compare quand même un hash quand l’adresse est inconnue', async () => {
    const spy = vi.spyOn(bcrypt, 'compare');
    db.user.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inconnu@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('rend le même refus qu’un mot de passe faux', async () => {
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

  // Un compte de service porte les écritures d'un token machine : il ne se connecte jamais.
  it('refuse un compte de service, mot de passe correct compris', async () => {
    db.user.findUnique.mockResolvedValue({ ...user, isService: true });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(401);
  });

  it('laisse entrer un mot de passe correct', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('bascule sur le second facteur sans émettre de jeton d’accès', async () => {
    db.user.findUnique.mockResolvedValue({ ...user, totpEnabledAt: new Date() });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@studio.com', password: 'Motdepasse1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requires2fa: true });
    expect(res.body).not.toHaveProperty('token');
  });
});
