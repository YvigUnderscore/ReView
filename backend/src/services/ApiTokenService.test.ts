// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppError } from '../lib/errors';

const { db } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    project: { findFirst: vi.fn() },
    projectMembership: { upsert: vi.fn() },
    apiToken: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/apiTokens', () => ({
  generateApiToken: () => ({ token: 'rvk_plain', tokenHash: 'hash' }),
}));

import bcrypt from 'bcryptjs';
import * as ApiTokenService from './ApiTokenService';

const HASH = bcrypt.hashSync('Motdepasse1', 4);

/** Application error as the error middleware sees it (status + code). */
const caught = async (fn: () => Promise<unknown>): Promise<AppError> => {
  try {
    await fn();
  } catch (err) {
    return err as AppError;
  }
  throw new Error('no error thrown');
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(null);
  db.project.findFirst.mockResolvedValue({ id: 4 });
  db.user.create.mockResolvedValue({ id: 55, isService: true });
  db.apiToken.create.mockImplementation((args: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 9, ...args.data }),
  );
});

describe('assertActorPassword', () => {
  it('accepts the correct password', async () => {
    db.user.findUnique.mockResolvedValue({ password: HASH });
    await expect(ApiTokenService.assertActorPassword(1, 'Motdepasse1')).resolves.toBeUndefined();
  });

  // 403 and not 401: a 401 would trigger session renewal on the client side, which purges the session
  // when it fails; a typo would log the user out.
  it('refuses a wrong password with a coded 403', async () => {
    db.user.findUnique.mockResolvedValue({ password: HASH });
    const err = await caught(() => ApiTokenService.assertActorPassword(1, 'MauvaisMdp1'));
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('CURRENT_PASSWORD_REQUIRED');
  });

  it('refuses a missing password', async () => {
    db.user.findUnique.mockResolvedValue({ password: HASH });
    const err = await caught(() => ApiTokenService.assertActorPassword(1, undefined));
    expect(err.statusCode).toBe(403);
  });

  it('refuses an unknown account without comparing anything', async () => {
    const err = await caught(() => ApiTokenService.assertActorPassword(404, 'Motdepasse1'));
    expect(err.statusCode).toBe(403);
  });
});

describe('createService', () => {
  it('rejects an unknown scope, naming it', async () => {
    const err = await caught(() =>
      ApiTokenService.createService(1, { name: 'Farm', scopes: ['versions:write', 'chaos:write'] }),
    );
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('UNKNOWN_SCOPE');
    expect(err.message).toContain('chaos:write');
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent scoping project', async () => {
    db.project.findFirst.mockResolvedValue(null);
    const err = await caught(() =>
      ApiTokenService.createService(1, { name: 'Farm', scopes: ['read'], projectId: 77 }),
    );
    expect(err.statusCode).toBe(404);
    expect(db.apiToken.create).not.toHaveBeenCalled();
  });

  it('creates the bearer account, scopes it to the project and returns the secret only once', async () => {
    const out = await ApiTokenService.createService(1, {
      name: 'Render farm',
      scopes: ['versions:write'],
      role: 'SUPERVISOR',
      projectId: 4,
      expiresInDays: 30,
    });
    expect(out.token).toBe('rvk_plain');
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'svc-render-farm@service.review.invalid',
          role: 'SUPERVISOR',
          isService: true,
        }),
      }),
    );
    // Without membership, an ARTIST bearer would see nothing of the project it feeds.
    expect(db.projectMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: 55, projectId: 4 } }),
    );
    const data = db.apiToken.create.mock.calls[0]?.[0]?.data as { expiresAt: Date; kind: string };
    expect(data.kind).toBe('SERVICE');
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('never expires when no duration is given', async () => {
    await ApiTokenService.createService(1, { name: 'Farm', scopes: ['read'] });
    const data = db.apiToken.create.mock.calls[0]?.[0]?.data as { expiresAt: Date | null };
    expect(data.expiresAt).toBeNull();
    expect(db.projectMembership.upsert).not.toHaveBeenCalled();
  });

  it('reuses the existing service account and adjusts its role', async () => {
    db.user.findUnique.mockResolvedValue({ id: 55, isService: true });
    await ApiTokenService.createService(1, { name: 'Render farm', scopes: ['read'], role: 'CLIENT' });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { role: 'CLIENT' } });
  });

  // Without this guard, naming a token like a person would hijack that person's account.
  it('refuses to bind to a human account carrying the same address', async () => {
    db.user.findUnique.mockResolvedValue({ id: 3, isService: false });
    const err = await caught(() =>
      ApiTokenService.createService(1, { name: 'Render farm', scopes: ['read'] }),
    );
    expect(err.statusCode).toBe(409);
  });

  it('refuses a name with no usable character', async () => {
    const err = await caught(() => ApiTokenService.createService(1, { name: '???', scopes: ['read'] }));
    expect(err.statusCode).toBe(400);
  });
});

describe('listService and revokeService', () => {
  it('lists only live service tokens, with bearer and project', async () => {
    db.apiToken.findMany.mockResolvedValue([]);
    await ApiTokenService.listService();
    const args = db.apiToken.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(args.where).toEqual({ kind: 'SERVICE', revokedAt: null });
    expect(args.select).toHaveProperty('project');
    expect(args.select).toHaveProperty('user');
    expect(args.select).not.toHaveProperty('tokenHash');
  });

  it('revokes a live token', async () => {
    db.apiToken.updateMany.mockResolvedValue({ count: 1 });
    await expect(ApiTokenService.revokeService(1, 9)).resolves.toBeUndefined();
  });

  it('reports a token already revoked or unknown', async () => {
    db.apiToken.updateMany.mockResolvedValue({ count: 0 });
    const err = await caught(() => ApiTokenService.revokeService(1, 9));
    expect(err.statusCode).toBe(404);
  });
});
