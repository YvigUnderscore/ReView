// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Episode filter on a list of shots. The level is optional: without a filter, the query must be exactly
 * the same as before. A feature film must see nothing change, neither in its results nor in its execution plan.
 */

const { db, thumbs } = vi.hoisted(() => ({
  db: { shot: { findMany: vi.fn(), count: vi.fn() } },
  thumbs: {
    firstMediaThumbKeysForShots: vi.fn(),
    firstMediaThumbKeyForShot: vi.fn(),
    effectiveThumbnailUrl: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/thumbnails', () => thumbs);
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));

import { episodeWhere, list } from './ShotService';

const page = { page: 1, pageSize: 100, order: 'desc' as const };

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.findMany.mockResolvedValue([]);
  db.shot.count.mockResolvedValue(0);
  thumbs.firstMediaThumbKeysForShots.mockResolvedValue(new Map());
});

describe('episodeWhere', () => {
  it('restricts nothing without a filter', () => {
    expect(episodeWhere(undefined)).toEqual({});
  });

  it('goes through the sequence for a given episode', () => {
    // A shot does not belong to an episode directly: its sequence carries one.
    expect(episodeWhere(4)).toEqual({ sequence: { episodeId: 4 } });
  });

  it('"outside any episode" includes shots with no sequence at all', () => {
    // They are outside any episode by construction: leaving them out would make them unreachable.
    expect(episodeWhere('none')).toEqual({
      OR: [{ sequenceId: null }, { sequence: { episodeId: null } }],
    });
  });
});

describe('ShotService.list', () => {
  it('leaves the query intact when no episode is requested', async () => {
    await list(3, undefined, page);
    const args = db.shot.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ projectId: 3, deletedAt: null });
    expect(args.where.sequence).toBeUndefined();
    expect(args.where.OR).toBeUndefined();
  });

  it('combines the sequence filter and the episode filter', async () => {
    await list(3, 12, page, 4);
    const args = db.shot.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ sequenceId: 12, sequence: { episodeId: 4 } });
  });

  it('counts the total with the same filter as the page', async () => {
    await list(3, undefined, page, 4);
    const countArgs = db.shot.count.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(countArgs.where).toMatchObject({ projectId: 3, sequence: { episodeId: 4 } });
  });
});
