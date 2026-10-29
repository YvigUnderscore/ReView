// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks of external dependencies (no real DB/Redis/MinIO connection in this unit test).
vi.mock('./prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn(), delete: vi.fn() },
    project: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('./storage', () => ({
  storage: { deleteObject: vi.fn(), deleteObjects: vi.fn(), deletePrefix: vi.fn() },
}));
vi.mock('./queues', () => ({
  enqueueStorageCleanup: vi.fn(),
}));

import { purgeMedia, purgeProject } from './trash';
import { prisma } from './prisma';
import { storage } from './storage';
import { enqueueStorageCleanup } from './queues';

const findUnique = vi.mocked(prisma.mediaObject.findUnique);
const deleteMedia = vi.mocked(prisma.mediaObject.delete);
const deleteObjects = vi.mocked(storage.deleteObjects);
const deletePrefix = vi.mocked(storage.deletePrefix);
const projectFind = vi.mocked(prisma.project.findUnique);
const projectDelete = vi.mocked(prisma.project.delete);
const enqueue = vi.mocked(enqueueStorageCleanup);

describe('purge: invariant 10.D7 (DB first, storage after, orphans retried)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('purgeMedia: deletes the DB row, then, if MinIO fails, queues a retry without throwing', async () => {
    findUnique.mockResolvedValue({ id: 1, storageKey: 'k/a.mp4', thumbnailKey: 'k/a.jpg' } as never);
    deleteMedia.mockResolvedValue({} as never);
    deleteObjects.mockRejectedValue(new Error('MinIO down'));
    deletePrefix.mockRejectedValue(new Error('MinIO down'));
    enqueue.mockResolvedValue(undefined as never);

    await expect(purgeMedia(1)).resolves.toBeUndefined();

    // The DB deletion did take place (consistent state despite the storage failure).
    expect(deleteMedia).toHaveBeenCalledWith({ where: { id: 1 } });
    // Keys AND the derivatives prefix that failed are queued for retry (orphan log).
    expect(enqueue).toHaveBeenCalledWith({
      keys: ['k/a.mp4', 'k/a.jpg'],
      prefixes: ['derived/1/'],
    });
  });

  it('purgeMedia: also deletes the storage objects when MinIO responds (no retry)', async () => {
    findUnique.mockResolvedValue({ id: 2, storageKey: 'k/b.mp4', thumbnailKey: null } as never);
    deleteMedia.mockResolvedValue({} as never);
    deleteObjects.mockResolvedValue([]);
    deletePrefix.mockResolvedValue(undefined);

    await purgeMedia(2);

    expect(deleteObjects).toHaveBeenCalledWith(['k/b.mp4']);
    expect(enqueue).not.toHaveBeenCalled();
  });

  /**
   * The defect fixed here: the purge only knew `storageKey` and `thumbnailKey`. Yet everything
   * the workers produce lives under `derived/{mediaId}/` (HLS, proxy, client derivative, sprite,
   * GLB, spatial thumbnails), and for a video `storageKey` already points to the proxy. Deleting
   * a media therefore freed almost nothing: the demo bucket showed 801 KB of originals for
   * 3.56 GB of derivatives.
   */
  it("purgeMedia: also frees the media's derivatives", async () => {
    findUnique.mockResolvedValue({ id: 42, storageKey: 'k/c.mp4', thumbnailKey: null } as never);
    deleteMedia.mockResolvedValue({} as never);
    deleteObjects.mockResolvedValue([]);
    deletePrefix.mockResolvedValue(undefined);

    await purgeMedia(42);

    expect(deletePrefix).toHaveBeenCalledWith('derived/42/');
  });

  it('purgeProject: DB commit before deleting the prefixes; failed prefixes retried', async () => {
    projectFind.mockResolvedValue({ slug: 'demo' } as never);
    projectDelete.mockResolvedValue({} as never);
    deletePrefix.mockRejectedValue(new Error('MinIO down'));
    enqueue.mockResolvedValue(undefined as never);

    await expect(purgeProject(7)).resolves.toBeUndefined();

    expect(projectDelete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(enqueue).toHaveBeenCalledWith({ keys: [], prefixes: ['projects/demo/', 'projects/7/'] });
  });
});
