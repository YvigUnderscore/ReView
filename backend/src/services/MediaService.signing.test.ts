// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { mediaObject: { findMany: vi.fn(), count: vi.fn() } },
}));
vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('../lib/queues', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/settings', () => ({ getNumericSetting: vi.fn(), SETTING_KEYS: {} }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));

import { listPublished, listReviews } from './MediaService';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { checkProjectAccess } from '../middleware/rbac';
import { MediaKind, MediaStatus, Role } from '@prisma/client';

const findMany = vi.mocked(prisma.mediaObject.findMany);
const count = vi.mocked(prisma.mediaObject.count);
const presign = vi.mocked(storage.getPresignedGetUrl);
const access = vi.mocked(checkProjectAccess);

const artist = { id: 3, role: Role.ARTIST };
const page = { page: 1, pageSize: 500, order: 'desc' as const };

/** A page of `n` media, each with its thumbnail and its read key (2 signatures per media). */
function fakeMedia(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    kind: MediaKind.IMAGE,
    originalName: `plan_${i + 1}.png`,
    published: true,
    createdAt: new Date(2026, 0, 1 + (i % 28)),
    status: MediaStatus.READY,
    storageKey: `projects/p/plan_${i + 1}.png`,
    thumbnailKey: `derived/${i + 1}/thumbnail.jpg`,
    metadata: null,
    versionId: 100 + i,
    uploaderId: 3,
  }));
}

/**
 * Counts the event-loop turns crossed during `run`.
 *
 * This IS the measure of the PERF-09 defect: SigV4 signing resolves in microtasks, so a `Promise.all` over a
 * whole page never yields — no other request of the process is served between the first and the last media.
 * We therefore count loop turns, not milliseconds.
 */
async function countEventLoopTurns<T>(run: () => Promise<T>): Promise<{ turns: number; value: T }> {
  let turns = 0;
  let alive = true;
  const beat = (): void => {
    if (!alive) return;
    turns += 1;
    setImmediate(beat);
  };
  setImmediate(beat);
  const value = await run();
  alive = false;
  return { turns, value };
}

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue(true);
  presign.mockImplementation(async (k: string) => `https://minio/${k}`);
  count.mockResolvedValue(0);
});

describe('MediaService: signing of lists yields to the loop (PERF-09)', () => {
  it('listPublished: a page of 500 media lets the other requests through', async () => {
    const media = fakeMedia(500);
    findMany.mockResolvedValue(media as never);
    count.mockResolvedValue(media.length);

    const { turns, value } = await countEventLoopTurns(() => listPublished(artist, 7, undefined, page));

    // 500 media / 25 per slice = 20 slices, hence at least 19 loop yields. Without the slicing, `Promise.all`
    // over the 500 yields exactly 0.
    expect(turns).toBeGreaterThanOrEqual(19);
    // Two signatures per media, none fewer: the fix removes nothing from the response.
    expect(presign).toHaveBeenCalledTimes(1000);
    expect(value.items).toHaveLength(500);
  });

  it('listPublished: output identical to a single-block signing (same rows, same order)', async () => {
    const media = fakeMedia(120);
    findMany.mockResolvedValue(media as never);
    count.mockResolvedValue(media.length);

    const out = await listPublished(artist, 7, undefined, { ...page, pageSize: 120 });

    // The reference is built here exactly as the former `Promise.all` did.
    const expected = await Promise.all(
      media.map(async (m) => ({
        id: m.id,
        kind: m.kind,
        originalName: m.originalName,
        thumbnailUrl: await storage.getPresignedGetUrl(m.thumbnailKey),
        url: await storage.getPresignedGetUrl(m.storageKey),
      })),
    );
    expect(out.items).toEqual(expected);
    expect(out.total).toBe(120);
  });

  it('small page: no useless slicing below the threshold', async () => {
    const media = fakeMedia(10);
    findMany.mockResolvedValue(media as never);
    count.mockResolvedValue(media.length);

    const { turns } = await countEventLoopTurns(() =>
      listPublished(artist, 7, undefined, { ...page, pageSize: 10 }),
    );
    expect(turns).toBe(0);
  });

  it('listReviews: the same slicing on the global Reviews page', async () => {
    const media = fakeMedia(200).map((m) => ({
      ...m,
      kind: MediaKind.VIDEO,
      metadata: { timelineSprite: { key: `derived/${m.id}/sprite.jpg`, count: 10, cols: 5, rows: 2 } },
      uploader: { id: 3, name: 'Artiste' },
      version: { name: 'V01', reviewStatus: null, task: null, asset: null },
    }));
    findMany.mockResolvedValue(media as never);
    count.mockResolvedValue(media.length);

    const { turns, value } = await countEventLoopTurns(() =>
      listReviews(artist, {}, { ...page, pageSize: 200 }),
    );

    expect(turns).toBeGreaterThanOrEqual(7); // 200 / 25 = 8 tranches
    expect(presign).toHaveBeenCalledTimes(400); // thumbnail + sprite per media
    expect(value.items).toHaveLength(200);
  });
});
