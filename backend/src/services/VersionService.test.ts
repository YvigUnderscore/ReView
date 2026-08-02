// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    // Projet writable par défaut (38.B) : le verrou d’archivage interroge project.findFirst.
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

import { create, update } from './VersionService';
import { prisma } from '../lib/prisma';
import { emitToProject } from './SocketService';
import { Role } from '@prisma/client';

const count = vi.mocked(prisma.version.count);
const createVersion = vi.mocked(prisma.version.create);
const findUnique = vi.mocked(prisma.version.findUnique);
const updateVersion = vi.mocked(prisma.version.update);
const user = { id: 3, role: Role.ARTIST };

describe('VersionService.create — auto-nommage des versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createVersion.mockImplementation(({ data }: never) => Promise.resolve({ id: 1, ...data }) as never);
  });

  it('nomme V01 quand aucune version n’existe encore', async () => {
    count.mockResolvedValue(0 as never);
    await create(user, 7, { taskId: 42 });
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'V01', taskId: 42, authorId: 3 }) }),
    );
    expect(emitToProject).toHaveBeenCalledWith(
      7,
      'version:update',
      expect.objectContaining({ projectId: 7, taskId: 42 }),
    );
  });

  it('incrémente avec padding sur 2 chiffres (count 9 → V10)', async () => {
    count.mockResolvedValue(9 as never);
    await create(user, 7, { assetId: 5 });
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'V10', assetId: 5 }) }),
    );
  });

  it('respecte un nom explicite sans compter', async () => {
    await create(user, 7, { taskId: 1, name: 'Final' });
    expect(count).not.toHaveBeenCalled();
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Final' }) }),
    );
  });
});

describe('VersionService.update — verrou de publication de la transform (Phase 11)', () => {
  const transform = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };

  beforeEach(() => {
    vi.clearAllMocks();
    updateVersion.mockImplementation(
      ({ data }: never) => Promise.resolve({ id: 1, taskId: 42, assetId: null, ...data }) as never,
    );
  });

  it('refuse la transform sur une version publiée (403 PUBLISHED_LOCKED)', async () => {
    findUnique.mockResolvedValue({ authorId: 3, published: true } as never);
    await expect(update(user, 7, 1, { transform })).rejects.toMatchObject({
      statusCode: 403,
      code: 'PUBLISHED_LOCKED',
    });
    expect(updateVersion).not.toHaveBeenCalled();
  });

  it('accepte la transform sur une version non publiée (auteur)', async () => {
    findUnique.mockResolvedValue({ authorId: 3, published: false } as never);
    await update(user, 7, 1, { transform });
    expect(updateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transform }) }),
    );
  });

  it('autorise encore le renommage d’une version publiée (seule la transform est figée)', async () => {
    findUnique.mockResolvedValue({ authorId: 3, published: true } as never);
    await update(user, 7, 1, { name: 'V02_final' });
    expect(updateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'V02_final' }) }),
    );
  });
});
