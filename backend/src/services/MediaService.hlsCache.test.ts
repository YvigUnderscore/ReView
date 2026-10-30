// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({ prisma: { mediaObject: { findUnique: vi.fn() } } }));
vi.mock('../lib/storage', () => ({
  storage: {
    getObjectBuffer: vi.fn(),
    getObjectStream: vi.fn(),
    getPresignedGetUrl: vi.fn(),
  },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../lib/queues', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/settings', () => ({ getNumericSetting: vi.fn(), SETTING_KEYS: {} }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForVersion: vi.fn(),
  resolveStorageContextForVersion: vi.fn(),
}));
vi.mock('../lib/mediaAccess', () => ({ logMediaAccess: vi.fn() }));

import { getHlsFile, resetHlsPlaylistCache, __hlsCacheTesting } from './MediaService';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { checkProjectAccess } from '../middleware/rbac';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { Role } from '@prisma/client';

const findUnique = vi.mocked(prisma.mediaObject.findUnique);
const getObjectBuffer = vi.mocked(storage.getObjectBuffer);
const presign = vi.mocked(storage.getPresignedGetUrl);
const access = vi.mocked(checkProjectAccess);
const resolveProject = vi.mocked(resolveProjectIdForVersion);

const artist = { id: 3, role: Role.ARTIST };

/** A 27-segment sub-playlist of 2 s segments — the shape measured on the development stack. */
const RENDITION = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:2',
  ...Array.from({ length: 27 }, (_, i) => [
    `#EXTINF:2.000000,`,
    `360p_${String(i).padStart(3, '0')}.ts`,
  ]).flat(),
  '#EXT-X-ENDLIST',
  '',
].join('\n');

/** Reads a rendition going through the complete access check. */
const read = (id: number, file: string): Promise<string> => getHlsFile(artist, id, file).then((r) => r.body!);

beforeEach(() => {
  vi.clearAllMocks();
  resetHlsPlaylistCache();
  findUnique.mockResolvedValue({ published: true, uploaderId: 99, versionId: 5 } as never);
  resolveProject.mockResolvedValue(11);
  access.mockResolvedValue(true);
  getObjectBuffer.mockImplementation(async (key: string) => {
    // A real MinIO round trip is not instantaneous: without this yield, two "simultaneous" calls would not
    // really be so and the test would prove nothing.
    await new Promise((r) => setImmediate(r));
    return Buffer.from(RENDITION.replace(/360p_/g, `${key.split('/').pop()!.split('.')[0]}_`), 'utf8');
  });
  presign.mockImplementation(async (key: string) => `https://minio/${key}?X-Amz-Signature=deadbeef`);
});

describe('presignedRendition: twenty simultaneous viewers, a single read (PERF-12)', () => {
  it('twenty concurrent requests for the same rendition make only one MinIO round trip', async () => {
    const bodies = await Promise.all(Array.from({ length: 20 }, () => read(9, '360p.m3u8')));

    // The cache memoised the TEXT, hence only after resolution: twenty viewers arriving together all missed
    // the cache. It now memoises the promise.
    expect(getObjectBuffer).toHaveBeenCalledTimes(1);
    expect(presign).toHaveBeenCalledTimes(27); // 27 segments, signed only once
    // And everyone receives exactly the same playlist.
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('X-Amz-Signature=deadbeef');
  });

  it('a failed read is not memoised: the next request retries', async () => {
    getObjectBuffer.mockRejectedValueOnce(new Error('MinIO down'));
    await expect(read(9, '360p.m3u8')).rejects.toThrow();
    expect(__hlsCacheTesting.stats().entries).toBe(0);
    await expect(read(9, '360p.m3u8')).resolves.toContain('#EXTM3U');
    expect(getObjectBuffer).toHaveBeenCalledTimes(2);
  });
});

describe('presignedRendition: a dailies room fits in the cache (PERF-12)', () => {
  it('fifteen shots × 3 renditions all remain in cache after a playlist pass', async () => {
    const playlist = Array.from({ length: 15 }, (_, i) => i + 1);
    const renditions = ['360p.m3u8', '720p.m3u8', '1080p.m3u8'];
    for (const id of playlist) for (const f of renditions) await read(id, f);
    expect(getObjectBuffer).toHaveBeenCalledTimes(45);
    expect(__hlsCacheTesting.stats().entries).toBe(45);

    // Going back in the playlist: NO re-read. With the former cap of 32, the first thirteen shots had already
    // been evicted by the following ones.
    for (const id of playlist) for (const f of renditions) await read(id, f);
    expect(getObjectBuffer).toHaveBeenCalledTimes(45);
  });

  it('both caps hold: bounded entries, bytes counted', async () => {
    const body = await read(1, '360p.m3u8');
    expect(__hlsCacheTesting.stats()).toEqual({ entries: 1, bytes: Buffer.byteLength(body, 'utf8') });

    for (let id = 2; id <= __hlsCacheTesting.RENDITION_CACHE_MAX + 50; id += 1) await read(id, '360p.m3u8');
    const stats = __hlsCacheTesting.stats();
    expect(stats.entries).toBe(__hlsCacheTesting.RENDITION_CACHE_MAX);
    expect(stats.bytes).toBeLessThanOrEqual(__hlsCacheTesting.RENDITION_CACHE_MAX_BYTES);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('LRU eviction: re-reading an entry refreshes it (FIFO evicted the one just served)', async () => {
    const max = __hlsCacheTesting.RENDITION_CACHE_MAX;
    for (let id = 1; id <= max; id += 1) await read(id, '360p.m3u8'); // full cache
    await read(1, '360p.m3u8'); // re-read: 1 becomes the most recent again
    const before = getObjectBuffer.mock.calls.length;

    await read(max + 1, '360p.m3u8'); // one entry more ⇒ one eviction

    await read(1, '360p.m3u8'); // still there (refreshed)
    expect(getObjectBuffer).toHaveBeenCalledTimes(before + 1);
    await read(2, '360p.m3u8'); // it is 2, the least recently read, that has gone
    expect(getObjectBuffer).toHaveBeenCalledTimes(before + 2);
  });
});
