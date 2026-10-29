// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({ prisma: { $queryRaw: vi.fn() } }));

import {
  activityByAsset,
  activityBySequence,
  activityByShot,
  mergeLatest,
  unseenFrom,
} from './entityFreshness';
import { prisma } from './prisma';

const d = (iso: string) => new Date(iso);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mergeLatest', () => {
  it('starts from the entity date and keeps only the most recent', () => {
    const out = mergeLatest(
      [
        { id: 1, updatedAt: d('2026-01-10T00:00:00Z') },
        { id: 2, updatedAt: d('2026-01-10T00:00:00Z') },
      ],
      [
        [
          { id: 1, at: d('2026-01-05T00:00:00Z') },
          { id: 2, at: d('2026-02-01T00:00:00Z') },
        ],
      ],
    );
    // Shot 1: its descendants are older, its own date wins.
    expect(out.get(1)).toEqual(d('2026-01-10T00:00:00Z'));
    // Shot 2: this is the whole trap of the batch — the delivery moved, the shot did not.
    expect(out.get(2)).toEqual(d('2026-02-01T00:00:00Z'));
  });

  it('ignores empty aggregates without losing the entity', () => {
    const out = mergeLatest([{ id: 7, updatedAt: d('2026-03-01T00:00:00Z') }], [[], [{ id: 7, at: null }]]);
    expect(out.get(7)).toEqual(d('2026-03-01T00:00:00Z'));
    expect(out.size).toBe(1);
  });
});

describe('unseenFrom', () => {
  const activity = new Map([
    [1, d('2026-02-01T00:00:00Z')],
    [2, d('2026-02-01T00:00:00Z')],
    [3, d('2026-02-01T00:00:00Z')],
  ]);

  it('never visited ⇒ unseen', () => {
    expect(unseenFrom(activity, new Map()).get(1)).toBe(true);
  });

  it('visited after the last activity ⇒ seen', () => {
    const visits = new Map([[2, d('2026-02-02T00:00:00Z')]]);
    expect(unseenFrom(activity, visits).get(2)).toBe(false);
  });

  it('visited before ⇒ lit again', () => {
    const visits = new Map([[3, d('2026-01-20T00:00:00Z')]]);
    expect(unseenFrom(activity, visits).get(3)).toBe(true);
  });

  it('on a perfect tie, the entity is deemed seen', () => {
    const visits = new Map([[1, d('2026-02-01T00:00:00Z')]]);
    expect(unseenFrom(activity, visits).get(1)).toBe(false);
  });
});

describe('activity reads — shape of the queries', () => {
  it('a shot: three flat aggregates, no two-level nested join', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    await activityByShot([{ id: 4, updatedAt: d('2026-01-01T00:00:00Z') }]);
    // Three, not one per card: it is the per-card multiplication that cost.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('a sequence: four aggregates (shots, tasks, deliveries, media)', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    await activityBySequence([{ id: 9, updatedAt: d('2026-01-01T00:00:00Z') }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it('an asset: three aggregates, BOTH attachment paths included', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    await activityByAsset([{ id: 2, updatedAt: d('2026-01-01T00:00:00Z') }]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    // `COALESCE(v."assetId", t."assetId")`: a version hangs from a task of the asset OR from the asset
    // itself. Following only one left half of the deliveries out.
    const sql = vi.mocked(prisma.$queryRaw).mock.calls.flat().join(' ');
    expect(sql).toContain('COALESCE');
  });

  it('empty list: no query', async () => {
    await Promise.all([activityByShot([]), activityBySequence([]), activityByAsset([])]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('does pick up the entity date alongside that of its descendants', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 4, at: d('2026-01-02T00:00:00Z') }] as never)
      .mockResolvedValueOnce([{ id: 4, at: d('2026-05-01T00:00:00Z') }] as never)
      .mockResolvedValueOnce([] as never);
    const out = await activityByShot([{ id: 4, updatedAt: d('2026-01-01T00:00:00Z') }]);
    expect(out.get(4)).toEqual(d('2026-05-01T00:00:00Z'));
  });
});
