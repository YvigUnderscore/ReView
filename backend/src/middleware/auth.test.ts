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
  // L'identité est mise en cache 30 s (B3) : sans purge, un test hériterait de
  // l'utilisateur résolu par le précédent.
  userCache.cache.clear();
  vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
  vi.mocked(isSessionActive).mockResolvedValue(true);
});

describe('authenticate — liste blanche des types de jetons', () => {
  it('accepte un jeton d’accès', async () => {
    const { req, next } = await run(signAccessToken({ ...dbUser, sid: 'abc' }));
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(dbUser);
  });

  // Tous les jetons de l'app sont signés avec le même JWT_SECRET. Chacun de ceux-ci est
  // une signature valide : seul le `kind` les distingue d'un jeton d'accès.
  it('refuse un refresh token', async () => {
    const { res, next } = await run(signRefreshToken({ ...dbUser, sid: 'abc' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  // Le jeton 2FA est émis après le mot de passe mais AVANT le code TOTP : l'accepter
  // reviendrait à faire du second facteur une formalité.
  it('refuse un jeton intermédiaire 2FA', async () => {
    const { res, next } = await run(signTwoFaToken(dbUser.id));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('refuse une session de partage client', async () => {
    const { res, next } = await run(signShareSession(42));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('refuse un jeton d’état OIDC', async () => {
    const token = jwt.sign({ kind: 'oidc', state: 's', nonce: 'n' }, env.JWT_SECRET);
    const { res, next } = await run(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  // Un `kind` inconnu (type de jeton ajouté plus tard) doit être refusé par défaut.
  it('refuse tout kind inconnu', async () => {
    const token = jwt.sign({ id: 7, email: dbUser.email, role: 'ADMIN', kind: 'futur' }, env.JWT_SECRET);
    const { res, next } = await run(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('refuse un jeton sans id numérique', async () => {
    const token = jwt.sign({ email: dbUser.email, role: 'ADMIN' }, env.JWT_SECRET);
    const { res, next } = await run(token);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('authenticate — session et existence du compte', () => {
  it('refuse quand la session a été révoquée', async () => {
    vi.mocked(isSessionActive).mockResolvedValue(false);
    const { res, next } = await run(signAccessToken({ ...dbUser, sid: 'revoked' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('refuse un jeton dont le compte n’existe plus', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const { res, next } = await run(signAccessToken({ ...dbUser, sid: 'abc' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  // Le rôle est relu en base : un jeton émis avant une rétrogradation ne doit pas
  // continuer à porter l'ancien rôle.
  it('recharge le rôle courant plutôt que celui du jeton', async () => {
    const stale = signAccessToken({ id: 7, email: dbUser.email, role: 'ADMIN', sid: 'abc' });
    const { req } = await run(stale);
    expect(req.user?.role).toBe('ARTIST');
  });
});
