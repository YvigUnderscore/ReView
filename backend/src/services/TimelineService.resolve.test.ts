// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, latest } = vi.hoisted(() => ({
  db: {
    timeline: { findUnique: vi.fn() },
    shot: { findMany: vi.fn() },
    timelineSnapshot: { findFirst: vi.fn(), findMany: vi.fn() },
  },
  latest: { latestForShots: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./PipelineLatestService', () => latest);
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn((k: string) => Promise.resolve(`url:${k}`)),
    statObject: vi.fn(),
  },
}));
vi.mock('./JobService', () => ({
  enqueueTimelineExport: vi.fn(),
  timelineExportJobId: vi.fn(),
  timelineExportQueue: { getJob: vi.fn() },
}));
vi.mock('../lib/projectSettings', () => ({
  resolveProjectSettingsById: vi.fn().mockResolvedValue({
    framerate: 25,
    resolution: { width: 1920, height: 1080 },
    departments: [{ key: 'comp', name: 'Compositing' }],
  }),
}));

import { resolve, listSnapshots } from './TimelineService';

/** A shot as the bounded query returns it (the fields of `shotSelect`). */
const shot = (
  id: number,
  code: string,
  order = 0,
  sequence: unknown = { id: 1, code: 'SQ01', order: 0 },
) => ({
  id,
  code,
  name: code,
  startFrame: 1001,
  endFrame: 1024,
  order,
  sequenceId: sequence ? 1 : null,
  sequence,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.timeline.findUnique.mockResolvedValue({
    id: 5,
    projectId: 3,
    sequenceId: null,
    department: null,
    name: null,
    updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    sequence: null,
  });
  db.shot.findMany.mockResolvedValue([]);
  db.timelineSnapshot.findFirst.mockResolvedValue(null);
  latest.latestForShots.mockResolvedValue(new Map());
});

describe('TimelineService.resolve: shots of the timeline', () => {
  it('bounds the query and sorts it on the database side', async () => {
        // The query used to load ALL the project's shots before sorting in memory. Without
        // `orderBy`, a cap would cut into an arbitrary set and the edit would change from one refresh to the next.
    await resolve(5);
    expect(db.shot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5000,
        orderBy: [
          { sequence: { order: 'asc' } },
          { sequence: { code: 'asc' } },
          { order: 'asc' },
          { code: 'asc' },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('keeps omitted and deleted shots out of the timeline', async () => {
    await resolve(5);
    const args = db.shot.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({ projectId: 3, deletedAt: null, omitted: false });
  });

  it('keeps the natural tie-break of codes, which SQL cannot do', async () => {
        // "SH2" must stay before "SH10": it is the in-memory sort that ensures it, and it remains the final judge after the SQL sort.
    db.shot.findMany.mockResolvedValue([shot(1, 'SH10'), shot(2, 'SH2')]);
    const view = await resolve(5);
    expect(view.items.map((i) => i.shotCode)).toEqual(['SH2', 'SH10']);
  });

  it('puts shots outside any sequence at the end of the timeline', async () => {
    db.shot.findMany.mockResolvedValue([shot(1, 'SH99', 0, null), shot(2, 'SH01')]);
    const view = await resolve(5);
    expect(view.items.map((i) => i.shotCode)).toEqual(['SH01', 'SH99']);
  });

  it('reports the truncation instead of hiding it', async () => {
    expect((await resolve(5)).truncated).toBe(false);
    db.shot.findMany.mockResolvedValue(
      new Array(5000).fill(null).map((_, i) => shot(i + 1, `SH${String(i).padStart(4, '0')}`)),
    );
    expect((await resolve(5)).truncated).toBe(true);
  });
});

describe('TimelineService.listSnapshots', () => {
  it('bounds the list without losing the recent revisions', async () => {
    db.timelineSnapshot.findMany.mockResolvedValue([]);
    await listSnapshots(5);
    expect(db.timelineSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { revision: 'desc' }, take: 200 }),
    );
  });
});
