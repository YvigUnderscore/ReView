// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: { mediaObject: { findMany: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock('./storage', () => ({
  storage: { deleteObject: vi.fn(), deletePrefix: vi.fn(), abortMultipartUpload: vi.fn() },
}));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { purgeStaleUploads, STALE_UPLOAD_HOURS } from './staleUploads';
import { prisma } from './prisma';
import { storage } from './storage';

const findMany = vi.mocked(prisma.mediaObject.findMany);
const deleteMany = vi.mocked(prisma.mediaObject.deleteMany);
const abortMultipart = vi.mocked(storage.abortMultipartUpload);

beforeEach(() => {
  vi.clearAllMocks();
  deleteMany.mockResolvedValue({ count: 0 });
  vi.mocked(storage.deleteObject).mockResolvedValue(undefined);
  vi.mocked(storage.deletePrefix).mockResolvedValue(undefined);
  abortMultipart.mockResolvedValue(undefined);
});

/**
 * A tab closed during an upload left an eternal `UPLOADING` row. Since `createUpload`
 * refuses beyond `MAX_CONCURRENT_UPLOADS` rows in that state, five accidents were enough
 * to block an account for good.
 */
describe('purgeStaleUploads', () => {
  it('does nothing when no stale upload exists', async () => {
    findMany.mockResolvedValue([] as never);
    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes the row, the stored object and any derivatives', async () => {
    findMany.mockResolvedValue([
      { id: 11, storageKey: 'projects/demo/a.mov' },
      { id: 12, storageKey: '' },
    ] as never);

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 2 });

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: [11, 12] } } });
    expect(storage.deleteObject).toHaveBeenCalledWith('projects/demo/a.mov');
    // Empty key: nothing to delete on the object side, but the prefix is still attempted.
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deletePrefix).toHaveBeenCalledWith('derived/11/');
    expect(storage.deletePrefix).toHaveBeenCalledWith('derived/12/');
  });

  it('only picks uploads older than the cutoff', async () => {
    findMany.mockResolvedValue([] as never);
    const before = Date.now();
    await purgeStaleUploads();
    const where = (findMany.mock.calls.at(-1)?.[0] as { where: { createdAt: { lt: Date } } }).where;
    const cutoff = where.createdAt.lt.getTime();
    expect(before - cutoff).toBeGreaterThanOrEqual(STALE_UPLOAD_HOURS * 3600 * 1000 - 1000);
  });

  it('survives an unavailable MinIO: the row is still released', async () => {
    findMany.mockResolvedValue([{ id: 13, storageKey: 'k/x.mov' }] as never);
    vi.mocked(storage.deleteObject).mockRejectedValue(new Error('MinIO down'));
    vi.mocked(storage.deletePrefix).mockRejectedValue(new Error('MinIO down'));

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 1 });
    expect(deleteMany).toHaveBeenCalled();
  });

  /**
   * A4-02 / INFRA-04. A multipart upload that was never completed has NO object at
   * `storageKey`: `DeleteObject` is a wasted round trip there, and the parts already
   * received — 30 GB for a master cut at 80% — stay in `.minio.sys/multipart/`, which
   * neither `ListObjectsV2`, `mc ls`, nor the storage report can see. Only
   * `AbortMultipartUpload` frees them, and its `uploadId` disappears with the row.
   */
  it('aborts the multipart upload instead of deleting an object that does not exist', async () => {
    findMany.mockResolvedValue([
      {
        id: 21,
        storageKey: 'projects/demo/shots/sh0100/v01/21/master.mov',
        metadata: { multipartUploadId: 'up-42', multipartPartSize: 16 * 1024 * 1024 },
        imageSequence: null,
      },
    ] as never);

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 1 });

    expect(abortMultipart).toHaveBeenCalledWith('projects/demo/shots/sh0100/v01/21/master.mov', 'up-42');
    // One MinIO round trip instead of two, and it is the only one that frees anything.
    expect(abortMultipart).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(storage.deletePrefix).toHaveBeenCalledExactlyOnceWith('derived/21/');
  });

  it('empties the frame prefix of a sequence that was cut off midway', async () => {
    findMany.mockResolvedValue([
      {
        id: 22,
        storageKey: 'projects/demo/shots/sh0200/v03/22/sequence.json',
        metadata: {},
        imageSequence: { storagePrefix: 'projects/demo/shots/sh0200/v03/22/frames/' },
      },
    ] as never);

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 1 });

    expect(storage.deletePrefix).toHaveBeenCalledWith('projects/demo/shots/sh0200/v03/22/frames/');
    expect(storage.deleteObject).toHaveBeenCalledWith('projects/demo/shots/sh0200/v03/22/sequence.json');
    expect(abortMultipart).not.toHaveBeenCalled();
  });

  /**
   * These two columns hold the only threads leading to the bytes already stored. The
   * `deleteMany` erases them: if they were not read BEFORE, they are lost for good.
   */
  it('reads metadata and the sequence prefix before deleting the rows', async () => {
    findMany.mockResolvedValue([] as never);
    await purgeStaleUploads();
    const select = (findMany.mock.calls.at(-1)?.[0] as { select: Record<string, unknown> }).select;
    expect(select.metadata).toBe(true);
    expect(select.imageSequence).toEqual({ select: { storagePrefix: true } });
  });

  it('releases the row even if aborting the multipart upload fails (MinIO unavailable)', async () => {
    findMany.mockResolvedValue([
      { id: 23, storageKey: 'k/m.mov', metadata: { multipartUploadId: 'up-x' }, imageSequence: null },
    ] as never);
    abortMultipart.mockRejectedValue(new Error('MinIO down'));

    await expect(purgeStaleUploads()).resolves.toEqual({ purged: 1 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: [23] } } });
  });
});
