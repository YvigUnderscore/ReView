// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Aucune base ni MinIO réels : la purge planifiée est vérifiée sur ses appels.
vi.mock('./prisma', () => {
  const level = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue({}),
  });
  return {
    prisma: {
      mediaObject: level(),
      version: level(),
      shot: level(),
      sequence: level(),
      episode: level(),
      asset: level(),
      project: level(),
    },
  };
});
vi.mock('../services/StorageService', () => ({
  storage: {
    deleteObject: vi.fn().mockResolvedValue(undefined),
    deletePrefix: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../services/JobService', () => ({ enqueueStorageCleanup: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { purgeExpiredTrash, TRASH_PURGE_MAX_ITEMS } from './trash';
import { prisma } from './prisma';

/** Arguments du n-ième appel simulé (les types génériques de Prisma ne servent à rien ici). */
function callArgs<T>(fn: unknown, index = 0): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[index]![0] as T;
}

beforeEach(() => vi.clearAllMocks());

describe('purgeExpiredTrash — balayage plafonné de la corbeille', () => {
  it('rétention nulle ou négative : purge désactivée, aucune requête', async () => {
    await expect(purgeExpiredTrash(0)).resolves.toBe(0);
    await expect(purgeExpiredTrash(-1)).resolves.toBe(0);
    expect(prisma.mediaObject.findMany).not.toHaveBeenCalled();
  });

  it('descend la hiérarchie enfants → parents et compte chaque élément purgé', async () => {
    vi.mocked(prisma.mediaObject.findMany)
      .mockResolvedValueOnce([{ id: 1 }] as never) // balayage des médias expirés
      .mockResolvedValue([] as never); // relectures internes (clés storage d'une version)
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({
      storageKey: 'k/a.mp4',
      thumbnailKey: null,
    } as never);
    vi.mocked(prisma.version.findMany).mockResolvedValueOnce([{ id: 5 }] as never);

    await expect(purgeExpiredTrash(30)).resolves.toBe(2);

    expect(prisma.mediaObject.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(prisma.version.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('plafonne la passe : au-delà du budget, les niveaux suivants ne sont même pas interrogés', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as never);
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({
      storageKey: 'k/a.mp4',
      thumbnailKey: null,
    } as never);

    await expect(purgeExpiredTrash(30, 2)).resolves.toBe(2);

    expect(callArgs<{ take: number }>(prisma.mediaObject.findMany).take).toBe(2);
    // Budget épuisé : la purge reprendra à la passe suivante plutôt que de vider la base d'un coup.
    expect(prisma.version.findMany).not.toHaveBeenCalled();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('le budget restant se transmet au niveau suivant', async () => {
    vi.mocked(prisma.mediaObject.findMany)
      .mockResolvedValueOnce([{ id: 1 }] as never)
      .mockResolvedValue([] as never);
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({
      storageKey: 'k/a.mp4',
      thumbnailKey: null,
    } as never);

    await purgeExpiredTrash(30, 10);

    expect(callArgs<{ take: number }>(prisma.version.findMany).take).toBe(9);
  });

  it('sans budget explicite, la passe est bornée par le plafond du produit', async () => {
    await purgeExpiredTrash(30);
    expect(callArgs<{ take: number }>(prisma.mediaObject.findMany).take).toBe(TRASH_PURGE_MAX_ITEMS);
  });

  it('la coupure suit la durée de rétention demandée', async () => {
    const before = Date.now();
    await purgeExpiredTrash(7);
    const where = callArgs<{ where: { deletedAt: { lt: Date } } }>(prisma.mediaObject.findMany).where;
    expect(where.deletedAt.lt.getTime()).toBeLessThanOrEqual(before - 7 * 86_400_000);
    expect(where.deletedAt.lt.getTime()).toBeGreaterThan(before - 7 * 86_400_000 - 5_000);
  });
});
