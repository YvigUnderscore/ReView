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
  it('generates a 40-hex rvk_ token with its sha256 hash', () => {
    const { token, tokenHash } = generateApiToken();
    expect(token).toMatch(/^rvk_[0-9a-f]{40}$/);
    expect(tokenHash).toBe(hashApiToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two generations do not look alike', () => {
    expect(generateApiToken().token).not.toBe(generateApiToken().token);
  });

  it('recognises the API token format vs a JWT', () => {
    expect(isApiTokenFormat(API_TOKEN_PREFIX + 'abc')).toBe(true);
    expect(isApiTokenFormat('eyJhbGciOi...')).toBe(false);
  });

  it('classifies read and write methods', () => {
    expect(isWriteMethod('GET')).toBe(false);
    expect(isWriteMethod('head')).toBe(false);
    expect(isWriteMethod('OPTIONS')).toBe(false);
    expect(isWriteMethod('POST')).toBe(true);
    expect(isWriteMethod('PATCH')).toBe(true);
    expect(isWriteMethod('DELETE')).toBe(true);
  });
});

/**
 * A1-01, third gate: an API token authenticates just like a password, through a fully separate
 * table. Its `select` only read `{ id, email, role }`: disabling the owning account was invisible to
 * it, and a token that revocation would not have taken away handed control back to someone who had left.
 */
describe('authenticateApiToken — disabled account', () => {
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
    // `lastUsedAt` is refreshed in the background (throttled): the mock must return a promise,
    // otherwise it is this detour that fails the test rather than the guard.
    db.apiToken.update.mockResolvedValue({});
  });

  it('refuses a token whose owning account is disabled', async () => {
    const { res, next } = await run(new Date());
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
  });

  it('lets an active account through, without propagating disabledAt', async () => {
    const { req, next } = await run(null);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({ id: 7, email: 'a@b.c', role: 'ARTIST' });
  });

  // The column must be requested: without it, the guard above would never see anything.
  it("loads the owner's disabling in its select", async () => {
    await run(null);
    const call = db.apiToken.findUnique.mock.calls[0]![0] as {
      select: { user: { select: Record<string, boolean> } };
    };
    expect(call.select.user.select).toMatchObject({ disabledAt: true });
  });
});
