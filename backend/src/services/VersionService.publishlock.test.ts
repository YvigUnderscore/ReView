// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteVersion: vi.fn(),
  restoreVersion: vi.fn(),
  purgeVersion: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { update } from './VersionService';
import { prisma } from '../lib/prisma';
import { Role, VersionStatus } from '@prisma/client';

const findUnique = vi.mocked(prisma.version.findUnique);
const updateVersion = vi.mocked(prisma.version.update);

const author = { id: 3, role: Role.ARTIST };
const supervisor = { id: 9, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  updateVersion.mockImplementation(({ data }: never) => Promise.resolve({ id: 1, ...data }) as never);
});

/**
 * Le verrou de publication (Phase 11) n'avait qu'un sens : seul le passage À l'état publié
 * était réservé aux superviseurs. L'auteur pouvait donc dépublier sa propre version — la
 * retirant du lien de partage client, décisions de review comprises — puis la modifier
 * librement, `assertNotPublished` ne voyant plus qu'un brouillon.
 */
describe('VersionService.update — verrou de publication bidirectionnel', () => {
  it('refuse à l’auteur de publier sa version', async () => {
    findUnique.mockResolvedValue({ authorId: author.id, published: false } as never);
    await expect(update(author, 7, 1, { status: VersionStatus.PUBLISHED })).rejects.toThrow(/superviseur/i);
  });

  it('refuse à l’auteur de DÉpublier sa version', async () => {
    findUnique.mockResolvedValue({ authorId: author.id, published: true } as never);
    await expect(update(author, 7, 1, { status: VersionStatus.DRAFT })).rejects.toThrow(/dépublier/i);
  });

  it('autorise un superviseur à dépublier', async () => {
    findUnique.mockResolvedValue({ authorId: author.id, published: true } as never);
    await expect(update(supervisor, 7, 1, { status: VersionStatus.DRAFT })).resolves.toBeDefined();
  });

  it('laisse l’auteur renommer une version non publiée', async () => {
    findUnique.mockResolvedValue({ authorId: author.id, published: false } as never);
    await expect(update(author, 7, 1, { name: 'V02' })).resolves.toBeDefined();
  });
});
