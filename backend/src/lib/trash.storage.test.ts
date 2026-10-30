// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// No real database or MinIO: this file measures what the purge ASKS of the storage,
// which keys, which prefixes, and in how many calls.
vi.mock('./prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
    version: { deleteMany: vi.fn() },
    project: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock('./storage', () => ({
  storage: {
    deleteObject: vi.fn(),
    deleteObjects: vi.fn(),
    deletePrefix: vi.fn(),
  },
}));
vi.mock('./queues', () => ({ enqueueStorageCleanup: vi.fn() }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { purgeMedia, purgeMedias, purgeProjects } from './trash';
import { prisma } from './prisma';
import { storage } from './storage';
import { enqueueStorageCleanup } from './queues';

const findUnique = vi.mocked(prisma.mediaObject.findUnique);
const findMany = vi.mocked(prisma.mediaObject.findMany);
const deleteMany = vi.mocked(prisma.mediaObject.deleteMany);
const deleteObject = vi.mocked(storage.deleteObject);
const deleteObjects = vi.mocked(storage.deleteObjects);
const deletePrefix = vi.mocked(storage.deletePrefix);
const enqueue = vi.mocked(enqueueStorageCleanup);

/** Key as produced by `StorageService.mediaKey`: the folder carries the media's id. */
const mediaFolder = (id: number) => `projects/durian-open-movie/shots/sq010/sh0010/v01/${id}/`;
const mediaKeyOf = (id: number, filename: string) => `${mediaFolder(id)}${filename}`;

beforeEach(() => {
  vi.clearAllMocks();
  deleteObjects.mockResolvedValue([]);
  deletePrefix.mockResolvedValue(undefined);
  enqueue.mockResolvedValue(undefined as never);
  vi.mocked(prisma.mediaObject.delete).mockResolvedValue({} as never);
  deleteMany.mockResolvedValue({ count: 0 });
});

/**
 * A4-01. The frames of an image sequence live under `…/{mediaId}/frames/`, a prefix that only
 * the `ImageSequence` row names. The purge only read `storageKey`/`thumbnailKey`, so destroying
 * a delivery of 2,000 EXRs left the bytes in the bucket forever, with nothing left in the
 * database to find them, and the project's quota fell back to zero.
 */
describe('purge of a media: everything it owns, and nothing else', () => {
  it('removes the media folder (original file, manifest, frames)', async () => {
    findUnique.mockResolvedValue({
      id: 19,
      storageKey: mediaKeyOf(19, 'sequence.json'),
      thumbnailKey: null,
      imageSequence: { storagePrefix: `${mediaFolder(19)}frames/` },
    } as never);

    await purgeMedia(19);

    const prefixes = deletePrefix.mock.calls.map((call) => call[0]);
    expect(prefixes).toContain('derived/19/');
    // The media folder holds `frames/` AND the manifest: a single prefix is enough.
    expect(prefixes).toContain(mediaFolder(19));
  });

  it('unexpected key: falls back to the frames prefix, never to an overly broad folder', async () => {
    findUnique.mockResolvedValue({
      id: 7,
      storageKey: 'legacy/ancienne-convention/master.exr',
      thumbnailKey: null,
      imageSequence: { storagePrefix: 'legacy/ancienne-convention/frames/' },
    } as never);

    await purgeMedia(7);

    const prefixes = deletePrefix.mock.calls.map((call) => call[0]);
    expect(prefixes).toEqual(['derived/7/', 'legacy/ancienne-convention/frames/']);
    // Certainly not `legacy/ancienne-convention/`, which is not provably its own.
    expect(prefixes).not.toContain('legacy/ancienne-convention/');
  });

  it('empty key (media created but not yet named): no root prefix', async () => {
    findUnique.mockResolvedValue({
      id: 3,
      storageKey: '',
      thumbnailKey: null,
      imageSequence: null,
    } as never);

    await purgeMedia(3);

    // An empty prefix would empty the whole bucket: it must never be produced.
    expect(deletePrefix.mock.calls.map((call) => call[0])).toEqual(['derived/3/']);
    expect(deleteObjects).not.toHaveBeenCalled();
  });
});

/**
 * PERF-11. The cost is measured in MinIO round trips, not by the stopwatch: the grouped path
 * called the single purge inside a loop, i.e. two object deletions per media, in series, in
 * the HTTP request's thread.
 */
describe('bulk purge: number of round trips', () => {
  it('200 media: one read, one DB deletion, ONE single DeleteObjects for 400 keys', async () => {
    const ids = Array.from({ length: 200 }, (_, index) => index + 1);
    findMany.mockResolvedValue(
      ids.map((id) => ({
        id,
        storageKey: mediaKeyOf(id, `plan-${id}.mp4`),
        thumbnailKey: `derived/${id}/thumbnail.webp`,
        imageSequence: null,
      })) as never,
    );

    await purgeMedias(ids);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ids } } });
    // Before: 400 `deleteObject` calls. After: one call carrying the 400 keys.
    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect(deleteObjects.mock.calls[0]![0]).toHaveLength(400);
  });

  it('empty batch: no query, no storage call', async () => {
    await purgeMedias([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it('failed prefixes are re-queued IN ORDER, despite the parallelism', async () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    findMany.mockResolvedValue(
      ids.map((id) => ({
        id,
        storageKey: mediaKeyOf(id, `plan-${id}.mp4`),
        thumbnailKey: null,
        imageSequence: null,
      })) as never,
    );
    // One prefix in two fails, with inverted latencies: without an explicit re-ordering,
    // the re-queued list would depend on the arrival order of the rejections.
    let rank = 0;
    deletePrefix.mockImplementation(async (prefix: string) => {
      const delay = (23 - rank++) % 7;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (prefix.startsWith('derived/')) throw new Error('MinIO down');
    });

    await purgeMedias(ids);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]![0].prefixes).toEqual(ids.map((id) => `derived/${id}/`));
  });
});

describe('bulk project purge', () => {
  it('deletes the rows found and removes both prefix forms, per project', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: 3, slug: 'alpha' },
      { id: 4, slug: 'beta' },
    ] as never);
    vi.mocked(prisma.project.deleteMany).mockResolvedValue({ count: 2 });

    await purgeProjects([3, 4, 99]);

    expect(prisma.project.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [3, 4] } } });
    expect([...deletePrefix.mock.calls.map((call) => call[0])].sort()).toEqual(
      ['projects/3/', 'projects/4/', 'projects/alpha/', 'projects/beta/'].sort(),
    );
  });
});
