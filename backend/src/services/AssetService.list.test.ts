// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, thumbs } = vi.hoisted(() => ({
  db: {
    asset: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    // "Awaiting review" dot: a single grouped SQL aggregate for the whole page.
    $queryRaw: vi.fn(),
  },
  thumbs: {
    firstMediaThumbKeysForAssets: vi.fn(),
    firstMediaThumbKeyForAsset: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/thumbnails', () => thumbs);

import { list, getDetail } from './AssetService';
import { decodeCursor, encodeCursor } from '../lib/pagination';

const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
  db.asset.findMany.mockResolvedValue([
    // `include.assignees`: Prisma always returns the requested relation.
    { id: 4, name: 'Ship', thumbnailKey: null, assignees: [] },
  ]);
  db.asset.count.mockResolvedValue(1);
  thumbs.firstMediaThumbKeysForAssets.mockResolvedValue(new Map());
  thumbs.firstMediaThumbKeyForAsset.mockResolvedValue(null);
  thumbs.effectiveThumbnailUrl.mockResolvedValue(null);
});

describe('AssetService.list', () => {
  it('sorts by name then id, the same rule used everywhere else', async () => {
    await list(3, page);
    expect(db.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('keeps the steps and tasks that the cards\' context menu consumes', async () => {
    await list(3, page);
    const args = db.asset.findMany.mock.calls[0]![0] as { include: Record<string, unknown> };
    expect(args.include.departments).toBeDefined();
    expect(args.include.tasks).toBeDefined();
    expect(args.include._count).toEqual({ select: { versions: true, tasks: true } });
  });

  it('resolves thumbnails in one grouped pass', async () => {
    await list(3, page);
    expect(thumbs.firstMediaThumbKeysForAssets).toHaveBeenCalledTimes(1);
    expect(thumbs.firstMediaThumbKeysForAssets).toHaveBeenCalledWith([4]);
  });

  it('resumes after the cursor on the (name, id) pair', async () => {
    await list(3, { ...page, cursor: encodeCursor('Ship', 4) });
    const args = db.asset.findMany.mock.calls[0]![0] as { skip: number; where: { AND: unknown[] } };
    expect(args.skip).toBe(0);
    expect(args.where.AND).toEqual([
      { OR: [{ name: { gt: 'Ship' } }, { AND: [{ name: 'Ship' }, { id: { gt: 4 } }] }] },
    ]);
  });

  it('returns a next-page cursor when the page is full', async () => {
    db.asset.findMany.mockResolvedValue([
      { id: 4, name: 'Ship', thumbnailKey: null, assignees: [] },
      { id: 9, name: 'Tank', thumbnailKey: null, assignees: [] },
    ]);
    db.asset.count.mockResolvedValue(1000);
    const res = await list(3, { ...page, pageSize: 2 });
    expect(res).toMatchObject({ total: 1000, pageCount: 500, hasMore: true });
    expect(decodeCursor(res.nextCursor ?? undefined)).toEqual({ value: 'Tank', id: 9 });
  });
});

describe('AssetService.getDetail', () => {
  it('caps the version history and returns the real count', async () => {
    db.asset.findUnique.mockResolvedValue({ id: 4, projectId: 3, thumbnailKey: null });
    await getDetail(4);
    const include = db.asset.findUnique.mock.calls[0]![0].include as {
      versions: { take: number; orderBy: unknown };
      tasks: { take: number; orderBy: unknown };
      _count: unknown;
    };
    expect(include.versions).toMatchObject({
      take: 200,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(include.tasks).toMatchObject({ take: 200, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
    expect(include._count).toEqual({ select: { versions: true, tasks: true } });
  });

  it('reports a missing asset rather than returning an empty object', async () => {
    db.asset.findUnique.mockResolvedValue(null);
    await expect(getDetail(404)).rejects.toThrow();
  });

  it('computes the detail thumbnail as before the move out of the route', async () => {
    db.asset.findUnique.mockResolvedValue({ id: 4, projectId: 3, thumbnailKey: 'k.jpg' });
    thumbs.effectiveThumbnailUrl.mockResolvedValue('url:k.jpg');
    await expect(getDetail(4)).resolves.toMatchObject({ thumbnailUrl: 'url:k.jpg' });
    expect(thumbs.firstMediaThumbKeyForAsset).toHaveBeenCalledWith(4);
  });
});
