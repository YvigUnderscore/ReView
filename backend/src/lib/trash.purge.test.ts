// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// No real database or MinIO: the scheduled purge is verified through its calls.
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
vi.mock('./storage', () => ({
  storage: {
    deleteObject: vi.fn().mockResolvedValue(undefined),
    deleteObjects: vi.fn().mockResolvedValue([]),
    deletePrefix: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('./queues', () => ({ enqueueStorageCleanup: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { purgeExpiredTrash, TRASH_PURGE_MAX_ITEMS } from './trash';
import { prisma } from './prisma';

/** Arguments of the n-th mocked call (Prisma's generic types are of no use here). */
function callArgs<T>(fn: unknown, index = 0): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[index]![0] as T;
}

beforeEach(() => vi.clearAllMocks());

describe('purgeExpiredTrash — capped sweep of the trash', () => {
  it('zero or negative retention: purge disabled, no query', async () => {
    await expect(purgeExpiredTrash(0)).resolves.toBe(0);
    await expect(purgeExpiredTrash(-1)).resolves.toBe(0);
    expect(prisma.mediaObject.findMany).not.toHaveBeenCalled();
  });

  it('walks the hierarchy from children to parents and counts each purged item', async () => {
    vi.mocked(prisma.mediaObject.findMany)
      .mockResolvedValueOnce([{ id: 1 }] as never) // sweep of expired media
      .mockResolvedValue([] as never); // internal re-reads (storage keys of a version)
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({
      storageKey: 'k/a.mp4',
      thumbnailKey: null,
    } as never);
    vi.mocked(prisma.version.findMany).mockResolvedValueOnce([{ id: 5 }] as never);

    await expect(purgeExpiredTrash(30)).resolves.toBe(2);

    expect(prisma.mediaObject.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(prisma.version.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('caps the pass: beyond the budget, the next levels are not even queried', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValueOnce([{ id: 1 }, { id: 2 }] as never);
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue({
      storageKey: 'k/a.mp4',
      thumbnailKey: null,
    } as never);

    await expect(purgeExpiredTrash(30, 2)).resolves.toBe(2);

    expect(callArgs<{ take: number }>(prisma.mediaObject.findMany).take).toBe(2);
    // Budget exhausted: the purge resumes on the next pass rather than emptying the database at once.
    expect(prisma.version.findMany).not.toHaveBeenCalled();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it('the remaining budget carries over to the next level', async () => {
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

  it('without an explicit budget, the pass is bounded by the product cap', async () => {
    await purgeExpiredTrash(30);
    expect(callArgs<{ take: number }>(prisma.mediaObject.findMany).take).toBe(TRASH_PURGE_MAX_ITEMS);
  });

  it('the cutoff follows the requested retention period', async () => {
    const before = Date.now();
    await purgeExpiredTrash(7);
    const where = callArgs<{ where: { deletedAt: { lt: Date } } }>(prisma.mediaObject.findMany).where;
    expect(where.deletedAt.lt.getTime()).toBeLessThanOrEqual(before - 7 * 86_400_000);
    expect(where.deletedAt.lt.getTime()).toBeGreaterThan(before - 7 * 86_400_000 - 5_000);
  });
});
