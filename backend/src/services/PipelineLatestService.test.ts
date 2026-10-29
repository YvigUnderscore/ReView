// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    shot: { findFirst: vi.fn() },
    asset: { findFirst: vi.fn() },
    project: { findUnique: vi.fn() },
    department: { findMany: vi.fn() },
  },
}));
vi.mock('../lib/storage', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
}));

import { latestForShots, latestForAssets } from './PipelineLatestService';
import { prisma } from '../lib/prisma';
import type { Department } from '../lib/projectSettings';

const findMany = vi.mocked(prisma.version.findMany);

/** The project's pipe, from upstream to downstream. */
const PIPE: Department[] = [
  { key: 'layout', name: 'Layout' },
  { key: 'anim', name: 'Animation' },
  { key: 'comp', name: 'Compositing' },
];

/** A row of the election pass: attachment, step, date, identifier. */
const candidate = (
  id: number,
  createdAt: string,
  task: { department: string | null; shotId?: number | null; assetId?: number | null } | null,
  assetId: number | null = null,
) => ({
  id,
  createdAt: new Date(createdAt),
  assetId,
  task: task
    ? { department: task.department, shotId: task.shotId ?? null, assetId: task.assetId ?? null }
    : null,
});

/** A row of the content pass: what the reader actually receives. */
const payload = (id: number, name: string) => ({
  id,
  name,
  status: 'PUBLISHED',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  assetId: null,
  author: null,
  reviewStatus: null,
  task: { id: 1, name: 'comp', department: 'comp', type: 'OTHER', shotId: 1, assetId: null },
  media: [],
});

/** Pass 1 (election) then pass 2 (content of the elected ones). */
function stubTwoPhases(candidates: unknown[], payloads: unknown[]) {
  findMany.mockResolvedValueOnce(candidates as never).mockResolvedValueOnce(payloads as never);
}

describe('PipelineLatestService: two-pass election', () => {
  // `resetAllMocks` and not `clearAllMocks`: otherwise the responses set by `mockResolvedValueOnce` would
  // survive from one test to the next and shift the passes.
  beforeEach(() => vi.resetAllMocks());

  it('does not touch the database without an entity to resolve', async () => {
    expect(await latestForShots([], PIPE)).toEqual(new Map());
    expect(await latestForAssets([], PIPE)).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });

  it('elects only one version per shot, and loads the content of the elected ones only', async () => {
    stubTwoPhases(
      [
        // Shot 1: compositing is more advanced than animation, even if published later.
        candidate(10, '2026-08-01T00:00:00Z', { department: 'anim', shotId: 1 }),
        candidate(11, '2026-08-02T00:00:00Z', { department: 'comp', shotId: 1 }),
        candidate(12, '2026-08-05T00:00:00Z', { department: 'anim', shotId: 1 }),
        // Shot 2: a single step, the most recent wins.
        candidate(20, '2026-08-01T00:00:00Z', { department: 'anim', shotId: 2 }),
        candidate(21, '2026-08-03T00:00:00Z', { department: 'anim', shotId: 2 }),
      ],
      [payload(11, 'V02'), payload(21, 'V03')],
    );

    const picks = await latestForShots([1, 2], PIPE);

    expect([...picks.keys()]).toEqual([1, 2]);
    expect(picks.get(1)!.versionId).toBe(11);
    expect(picks.get(2)!.versionId).toBe(21);
    // Pass 2: only the two elected ones, never the five contenders.
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1]![0]!.where).toEqual({ id: { in: [11, 21] } });
  });

  it('carries neither media nor author in the election pass', async () => {
    stubTwoPhases([], []);
    await latestForShots([1], PIPE);
    const select = findMany.mock.calls[0]![0]!.select as Record<string, unknown>;
    expect(Object.keys(select).sort()).toEqual(['assetId', 'createdAt', 'id', 'task']);
    expect(select.media).toBeUndefined();
    // Pass 2, for its part, does bring back the visible media.
    expect(findMany).toHaveBeenCalledTimes(1); // no elected version: no second pass
  });

  it('only requests published versions carrying a visible media', async () => {
    stubTwoPhases([], []);
    await latestForShots([1, 2], PIPE);
    expect(findMany.mock.calls[0]![0]!.where).toMatchObject({
      deletedAt: null,
      published: true,
      task: { shotId: { in: [1, 2] } },
    });
  });

  it('caps at the requested step, and falls back on the upstream when it is missing', async () => {
    stubTwoPhases(
      [
        candidate(10, '2026-08-01T00:00:00Z', { department: 'anim', shotId: 1 }),
        candidate(11, '2026-08-02T00:00:00Z', { department: 'comp', shotId: 1 }),
        // Shot 2: nothing in anim, only layout — the upstream fallback must play.
        candidate(20, '2026-08-01T00:00:00Z', { department: 'layout', shotId: 2 }),
      ],
      [payload(10, 'V01'), payload(20, 'V01')],
    );
    const picks = await latestForShots([1, 2], PIPE, 'anim');
    expect(picks.get(1)!.versionId).toBe(10);
    expect(picks.get(2)!.versionId).toBe(20);
  });

  it('resolves an asset by its task as well as by its direct version', async () => {
    stubTwoPhases(
      [
        candidate(30, '2026-08-01T00:00:00Z', { department: 'comp', assetId: 5 }),
        // Version attached directly to asset 6, without a task: off the pipe, it wins for lack of another
        // contender.
        candidate(31, '2026-08-02T00:00:00Z', null, 6),
      ],
      [payload(30, 'V01'), payload(31, 'V01')],
    );
    const picks = await latestForAssets([5, 6], PIPE);
    expect(picks.get(5)!.versionId).toBe(30);
    expect(picks.get(6)!.versionId).toBe(31);
  });

  it('ignores an entity none of whose versions survived the loading', async () => {
    // A version deleted between the two passes must not produce an empty entry.
    stubTwoPhases([candidate(40, '2026-08-01T00:00:00Z', { department: 'comp', shotId: 9 })], []);
    expect(await latestForShots([9], PIPE)).toEqual(new Map());
  });
});
