// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, thumbs } = vi.hoisted(() => ({
  db: {
    shot: { findMany: vi.fn(), count: vi.fn() },
        // "Waiting for review" badge: a grouped SQL aggregate for the whole page.
    $queryRaw: vi.fn(),
  },
  thumbs: {
    firstMediaThumbKeysForShots: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/thumbnails', () => ({
  firstMediaThumbKeyForShot: vi.fn(),
  firstMediaThumbKeysForShots: thumbs.firstMediaThumbKeysForShots,
  effectiveThumbnailUrl: thumbs.effectiveThumbnailUrl,
}));

import { list } from './ShotService';
import { decodeCursor, encodeCursor } from '../lib/pagination';

const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([]);
  db.shot.findMany.mockResolvedValue([
    {
      id: 7,
      code: 'SH010',
      thumbnailKey: null,
      departments: [{ id: 3, key: 'comp', name: 'Compositing', color: null }],
            // `include.assignees`: Prisma always returns the relation requested.
      assignees: [],
    },
  ]);
  db.shot.count.mockResolvedValue(1);
  thumbs.firstMediaThumbKeysForShots.mockResolvedValue(new Map());
  thumbs.effectiveThumbnailUrl.mockResolvedValue(null);
});

describe('ShotService.list: steps traversed', () => {
  it('requests the departments of each shot', async () => {
        // The department filter of the Shots tab compares the steps a shot goes through.
        // The list did not return them, only the sheet did, and choosing a department emptied the screen:
        // no card had a step to compare.
    await list(461, undefined, page);
    expect(db.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          departments: {
            select: { id: true, key: true, name: true, color: true },
            orderBy: { order: 'asc' },
          },
        }),
      }),
    );
  });

  it('leaves the departments intact in the response', async () => {
    const { items } = await list(461, undefined, page);
    expect(items[0]).toMatchObject({ departments: [{ id: 3, name: 'Compositing' }] });
  });
});

describe('ShotService.list: pagination of two thousand shots', () => {
  it('breaks sort ties by id', async () => {
        // An incremental ShotGrid import leaves every shot created with order = 0: without a tie-break,
        // Postgres is free to return ties in a different order from one page to the next, so page 2 shows
        // shots of page 1 again and skips as many.
    await list(461, undefined, page);
    expect(db.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ order: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('applies skip/take in page mode', async () => {
    await list(461, undefined, { ...page, page: 3, pageSize: 50 });
    expect(db.shot.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 50 }));
  });

  it('resumes after the cursor, without shifting, and still counts the total', async () => {
    await list(461, undefined, { ...page, page: 4, cursor: encodeCursor(0, 812) });
    const args = db.shot.findMany.mock.calls[0]![0] as {
      skip: number;
      where: { AND: unknown[]; projectId: number };
    };
    expect(args.skip).toBe(0);
    expect(args.where.AND).toEqual([
      { OR: [{ order: { gt: 0 } }, { AND: [{ order: 0 }, { id: { gt: 812 } }] }] },
    ]);
        // The total stays that of the whole project: it is what "2,000 shots" displays.
    expect(db.shot.count).toHaveBeenCalledWith({
      where: { projectId: 461, deletedAt: null, hiddenAt: null },
    });
  });

  it('returns a continuation cursor when the page is full', async () => {
    db.shot.findMany.mockResolvedValue([
      { id: 7, order: 0, code: 'SH010', thumbnailKey: null, departments: [], assignees: [] },
      { id: 9, order: 0, code: 'SH020', thumbnailKey: null, departments: [], assignees: [] },
    ]);
    db.shot.count.mockResolvedValue(2000);
    const res = await list(461, undefined, { ...page, pageSize: 2 });
    expect(res).toMatchObject({ total: 2000, pageCount: 1000, hasMore: true });
    expect(decodeCursor(res.nextCursor ?? undefined)).toEqual({ value: 0, id: 9 });
  });

  it('returns no cursor on the last page', async () => {
    const res = await list(461, undefined, page);
    expect(res.nextCursor).toBeNull();
    expect(res.hasMore).toBe(false);
  });
});
