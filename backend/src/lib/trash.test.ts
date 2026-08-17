// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks des dépendances externes (aucune connexion réelle DB/Redis/MinIO dans ce test unitaire).
vi.mock('./prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn(), delete: vi.fn() },
    project: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('../services/StorageService', () => ({
  storage: { deleteObject: vi.fn(), deletePrefix: vi.fn() },
}));
vi.mock('../services/JobService', () => ({
  enqueueStorageCleanup: vi.fn(),
}));

import { purgeMedia, purgeProject } from './trash';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';
import { enqueueStorageCleanup } from '../services/JobService';

const findUnique = vi.mocked(prisma.mediaObject.findUnique);
const deleteMedia = vi.mocked(prisma.mediaObject.delete);
const deleteObject = vi.mocked(storage.deleteObject);
const deletePrefix = vi.mocked(storage.deletePrefix);
const projectFind = vi.mocked(prisma.project.findUnique);
const projectDelete = vi.mocked(prisma.project.delete);
const enqueue = vi.mocked(enqueueStorageCleanup);

describe('purge — invariant 10.D7 (DB d’abord, storage après, orphelins retentés)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('purgeMedia : supprime la ligne DB puis, si MinIO échoue, enfile un retry sans lever', async () => {
    findUnique.mockResolvedValue({ storageKey: 'k/a.mp4', thumbnailKey: 'k/a.jpg' } as never);
    deleteMedia.mockResolvedValue({} as never);
    deleteObject.mockRejectedValue(new Error('MinIO down'));
    enqueue.mockResolvedValue(undefined as never);

    await expect(purgeMedia(1)).resolves.toBeUndefined();

    // La suppression DB a bien eu lieu (état cohérent malgré l'échec storage).
    expect(deleteMedia).toHaveBeenCalledWith({ where: { id: 1 } });
    // Les deux clés en échec sont enfilées pour retry (journal des orphelins).
    expect(enqueue).toHaveBeenCalledWith({ keys: ['k/a.mp4', 'k/a.jpg'], prefixes: [] });
  });

  it('purgeMedia : supprime aussi les objets storage quand MinIO répond (pas de retry)', async () => {
    findUnique.mockResolvedValue({ storageKey: 'k/b.mp4', thumbnailKey: null } as never);
    deleteMedia.mockResolvedValue({} as never);
    deleteObject.mockResolvedValue(undefined);

    await purgeMedia(2);

    expect(deleteObject).toHaveBeenCalledWith('k/b.mp4');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('purgeProject : commit DB avant suppression des préfixes ; préfixes en échec retentés', async () => {
    projectFind.mockResolvedValue({ slug: 'demo' } as never);
    projectDelete.mockResolvedValue({} as never);
    deletePrefix.mockRejectedValue(new Error('MinIO down'));
    enqueue.mockResolvedValue(undefined as never);

    await expect(purgeProject(7)).resolves.toBeUndefined();

    expect(projectDelete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(enqueue).toHaveBeenCalledWith({ keys: [], prefixes: ['projects/demo/', 'projects/7/'] });
  });
});
