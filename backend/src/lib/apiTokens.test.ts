// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { db } = vi.hoisted(() => ({
  db: { apiToken: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('./prisma', () => ({ prisma: db }));

import {
  API_TOKEN_PREFIX,
  authenticateApiToken,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
  isWriteMethod,
} from './apiTokens';

describe('apiTokens', () => {
  it('génère un token rvk_ de 40 hex avec son hash sha256', () => {
    const { token, tokenHash } = generateApiToken();
    expect(token).toMatch(/^rvk_[0-9a-f]{40}$/);
    expect(tokenHash).toBe(hashApiToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('deux générations ne se ressemblent pas', () => {
    expect(generateApiToken().token).not.toBe(generateApiToken().token);
  });

  it('reconnaît le format token API vs JWT', () => {
    expect(isApiTokenFormat(API_TOKEN_PREFIX + 'abc')).toBe(true);
    expect(isApiTokenFormat('eyJhbGciOi...')).toBe(false);
  });

  it('classe les méthodes lecture/écriture', () => {
    expect(isWriteMethod('GET')).toBe(false);
    expect(isWriteMethod('head')).toBe(false);
    expect(isWriteMethod('OPTIONS')).toBe(false);
    expect(isWriteMethod('POST')).toBe(true);
    expect(isWriteMethod('PATCH')).toBe(true);
    expect(isWriteMethod('DELETE')).toBe(true);
  });
});

/**
 * A1-01 — troisième porte : un token d'API authentifie aussi bien qu'un mot de passe, par
 * une table entièrement séparée. Son `select` ne lisait que `{ id, email, role }` : la
 * désactivation du compte porteur ne s'y voyait pas, et un token que la révocation n'aurait
 * pas emporté rendait la main à quelqu'un de parti.
 */
describe('authenticateApiToken — compte désactivé', () => {
  const run = async (disabledAt: Date | null) => {
    db.apiToken.findUnique.mockResolvedValue({
      id: 1,
      scopes: ['read'],
      revokedAt: null,
      expiresAt: null,
      projectId: null,
      kind: 'PERSONAL',
      user: { id: 7, email: 'a@b.c', role: 'ARTIST', disabledAt },
    });
    const req = { method: 'GET' } as Request;
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
    await authenticateApiToken(req, res as unknown as Response, next, 'rvk_x');
    return { req, res, next };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // `lastUsedAt` est rafraîchi en tâche de fond (throttlé) : le mock doit rendre une
    // promesse, sinon c'est ce détour-là qui fait échouer le test et non la garde.
    db.apiToken.update.mockResolvedValue({});
  });

  it('refuse un token dont le compte porteur est désactivé', async () => {
    const { res, next } = await run(new Date());
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('laisse passer un compte actif, sans propager disabledAt', async () => {
    const { req, next } = await run(null);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ id: 7, email: 'a@b.c', role: 'ARTIST' });
  });

  // La colonne doit être demandée : sans elle, la garde ci-dessus ne verrait jamais rien.
  it('charge la désactivation du porteur dans son select', async () => {
    await run(null);
    const call = db.apiToken.findUnique.mock.calls[0]![0] as {
      select: { user: { select: Record<string, boolean> } };
    };
    expect(call.select.user.select).toMatchObject({ disabledAt: true });
  });
});
