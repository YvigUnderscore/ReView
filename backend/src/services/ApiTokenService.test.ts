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

/** Erreur applicative telle que la voit le middleware d'erreur (statut + code). */
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
  it('laisse passer le bon mot de passe', async () => {
    db.user.findUnique.mockResolvedValue({ password: HASH });
    await expect(ApiTokenService.assertActorPassword(1, 'Motdepasse1')).resolves.toBeUndefined();
  });

  // 403 et non 401 : un 401 déclencherait le renouvellement de session côté client, qui
  // purge la session quand il échoue — une faute de frappe déconnecterait l'utilisateur.
  it('refuse un mot de passe faux avec un 403 codé', async () => {
    db.user.findUnique.mockResolvedValue({ password: HASH });
    const err = await caught(() => ApiTokenService.assertActorPassword(1, 'MauvaisMdp1'));
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('CURRENT_PASSWORD_REQUIRED');
  });

  it('refuse l’absence de mot de passe', async () => {
    db.user.findUnique.mockResolvedValue({ password: HASH });
    const err = await caught(() => ApiTokenService.assertActorPassword(1, undefined));
    expect(err.statusCode).toBe(403);
  });

  it('refuse un compte introuvable sans comparer quoi que ce soit', async () => {
    const err = await caught(() => ApiTokenService.assertActorPassword(404, 'Motdepasse1'));
    expect(err.statusCode).toBe(403);
  });
});

describe('createService', () => {
  it('rejette un scope inconnu en le nommant', async () => {
    const err = await caught(() =>
      ApiTokenService.createService(1, { name: 'Farm', scopes: ['versions:write', 'chaos:write'] }),
    );
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('UNKNOWN_SCOPE');
    expect(err.message).toContain('chaos:write');
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('rejette un projet de cantonnement inexistant', async () => {
    db.project.findFirst.mockResolvedValue(null);
    const err = await caught(() =>
      ApiTokenService.createService(1, { name: 'Farm', scopes: ['read'], projectId: 77 }),
    );
    expect(err.statusCode).toBe(404);
    expect(db.apiToken.create).not.toHaveBeenCalled();
  });

  it('crée le compte porteur, le cantonne au projet et rend le secret une seule fois', async () => {
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
    // Sans membership, un porteur ARTIST ne verrait rien du projet qu'il alimente.
    expect(db.projectMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: 55, projectId: 4 } }),
    );
    const data = db.apiToken.create.mock.calls[0]?.[0]?.data as { expiresAt: Date; kind: string };
    expect(data.kind).toBe('SERVICE');
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('n’expire jamais quand aucune durée n’est donnée', async () => {
    await ApiTokenService.createService(1, { name: 'Farm', scopes: ['read'] });
    const data = db.apiToken.create.mock.calls[0]?.[0]?.data as { expiresAt: Date | null };
    expect(data.expiresAt).toBeNull();
    expect(db.projectMembership.upsert).not.toHaveBeenCalled();
  });

  it('réutilise le compte de service existant et ajuste son rôle', async () => {
    db.user.findUnique.mockResolvedValue({ id: 55, isService: true });
    await ApiTokenService.createService(1, { name: 'Render farm', scopes: ['read'], role: 'CLIENT' });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { role: 'CLIENT' } });
  });

  // Sans cette garde, nommer un token comme une personne détournerait son compte.
  it('refuse de s’adosser à un compte humain portant la même adresse', async () => {
    db.user.findUnique.mockResolvedValue({ id: 3, isService: false });
    const err = await caught(() =>
      ApiTokenService.createService(1, { name: 'Render farm', scopes: ['read'] }),
    );
    expect(err.statusCode).toBe(409);
  });

  it('refuse un nom sans caractère exploitable', async () => {
    const err = await caught(() => ApiTokenService.createService(1, { name: '???', scopes: ['read'] }));
    expect(err.statusCode).toBe(400);
  });
});

describe('listService et revokeService', () => {
  it('ne liste que les tokens de service vivants, avec porteur et projet', async () => {
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

  it('révoque un token vivant', async () => {
    db.apiToken.updateMany.mockResolvedValue({ count: 1 });
    await expect(ApiTokenService.revokeService(1, 9)).resolves.toBeUndefined();
  });

  it('signale un token déjà révoqué ou inconnu', async () => {
    db.apiToken.updateMany.mockResolvedValue({ count: 0 });
    const err = await caught(() => ApiTokenService.revokeService(1, 9));
    expect(err.statusCode).toBe(404);
  });
});
