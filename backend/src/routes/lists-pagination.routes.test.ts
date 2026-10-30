// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Pagination contract of the lists that follow the studio's volume (shots, sequences, tasks). What the
 * front end consumes is decided here: what is accepted as input (`pageSize` beyond one hundred, `cursor`)
 * and what is returned as output (`total`, `pageCount`, `hasMore`, `nextCursor`).
 */

const { db, shots, tasks } = vi.hoisted(() => ({
  db: {
    sequence: { findMany: vi.fn(), count: vi.fn() },
    shot: { count: vi.fn() },
    // "Awaiting review" badge of a sequence: grouped SQL aggregate.
    $queryRaw: vi.fn(),
  },
  shots: { list: vi.fn() },
  tasks: { list: vi.fn(), listForBoard: vi.fn(), listForProject: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, role: 'ADMIN' } as Request['user'];
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  assertProjectAccess: vi.fn(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('./trashRoutes', () => ({ mountTrashRoutes: vi.fn() }));
vi.mock('../services/ShotService', () => shots);
vi.mock('../services/TaskService', () => tasks);
// `signSequenceThumbnails`: the list returns the effective thumbnail of each sequence.
vi.mock('../services/SequenceService', () => ({
  createBulk: vi.fn(),
  getDetail: vi.fn(),
  signSequenceThumbnails: vi.fn((rows: { id: number }[]) => rows.map((r) => ({ ...r, thumbnailUrl: null }))),
}));
vi.mock('../services/EntityVisitService', () => ({ unseenBySequence: () => Promise.resolve(new Map()) }));
vi.mock('../services/PipelineLatestService', () => ({ shotOverview: vi.fn(), assetOverview: vi.fn() }));
vi.mock('../services/PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));
vi.mock('../services/shotgrid/ShotgridGuardService', () => ({ assertLocalCreationAllowed: vi.fn() }));
vi.mock('../services/shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForShot: vi.fn().mockResolvedValue(1),
  resolveProjectIdForAsset: vi.fn().mockResolvedValue(1),
  resolveProjectIdForTask: vi.fn().mockResolvedValue(1),
  resolveProjectIdForSequence: vi.fn().mockResolvedValue(1),
}));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));

import express from 'express';
import request from 'supertest';
import shotsRoutes from './shots.routes';
import sequencesRoutes from './sequences.routes';
import tasksRoutes from './tasks.routes';
import { errorHandler } from '../middleware/error';
import { encodeCursor, MAX_PAGE_SIZE } from '../lib/pagination';

const app = express()
  .use(express.json())
  .use('/api/shots', shotsRoutes)
  .use('/api/sequences', sequencesRoutes)
  .use('/api/tasks', tasksRoutes)
  .use(errorHandler);

/** What the route passes to the service: 5th argument = the reader (batch 9, personal highlight). */
const listedWith = (seq: unknown, page: unknown, episode: unknown) =>
  expect(shots.list).toHaveBeenCalledWith(1, seq, page, episode, 1);

const emptyPage = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 100,
  pageCount: 1,
  hasMore: false,
  nextCursor: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  shots.list.mockResolvedValue(emptyPage);
  tasks.list.mockResolvedValue(emptyPage);
  tasks.listForBoard.mockResolvedValue({ items: [], total: 0, truncated: false, nextCursor: null });
  tasks.listForProject.mockResolvedValue({ items: [], total: 0, truncated: false, nextCursor: null });
  db.sequence.findMany.mockResolvedValue([]);
  db.sequence.count.mockResolvedValue(0);
  db.shot.count.mockResolvedValue(0);
});

describe('GET /api/shots — ceiling and cursor', () => {
  it('finally accepts more than a hundred rows per page', async () => {
    // The ceiling WAS the default: asking for 200 shots was impossible, and the front end never
    // requested page 2 — 1,900 shots out of 2,000 were out of reach.
    const res = await request(app).get('/api/shots?projectId=1&pageSize=200');
    expect(res.status).toBe(200);
    listedWith(undefined, expect.objectContaining({ pageSize: 200 }), undefined);
  });

  it('rejects beyond the hard ceiling', async () => {
    const res = await request(app).get(`/api/shots?projectId=1&pageSize=${MAX_PAGE_SIZE + 1}`);
    expect(res.status).toBe(400);
  });

  it('passes the cursor on to the service', async () => {
    const cursor = encodeCursor(0, 812);
    await request(app).get(`/api/shots?projectId=1&cursor=${encodeURIComponent(cursor)}`);
    listedWith(undefined, expect.objectContaining({ cursor }), undefined);
  });

  it('keeps the sequence filter, "none" included', async () => {
    await request(app).get('/api/shots?projectId=1&sequenceId=none&page=2');
    listedWith('none', expect.objectContaining({ page: 2 }), undefined);
  });

  it('passes the episode filter on, "none" included', async () => {
    // Express 5 makes `req.query` read-only: the value coerced by Zod does not rewrite the original
    // string, exactly as for `sequenceId`. The service normalizes with `Number()`: this is verified in
    // `ShotService.episode.test.ts`.
    await request(app).get('/api/shots?projectId=1&episodeId=4');
    listedWith(undefined, expect.anything(), '4');
    await request(app).get('/api/shots?projectId=1&episodeId=none');
    listedWith(undefined, expect.anything(), 'none');
  });

  it('rejects an episode that is neither an integer nor "none"', async () => {
    expect((await request(app).get('/api/shots?projectId=1&episodeId=EP1')).status).toBe(400);
  });
});

describe('GET /api/sequences — bounded list', () => {
  it('keeps the historical shape and adds what is needed to know what is missing', async () => {
    db.sequence.findMany.mockResolvedValue([{ id: 1, code: 'SQ01', _count: { shots: 12 }, assignees: [] }]);
    db.sequence.count.mockResolvedValue(640);
    db.shot.count.mockResolvedValue(4);
    db.$queryRaw.mockResolvedValue([]);
    const res = await request(app).get('/api/sequences?projectId=1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      // `thumbnailUrl` is part of the shape: the card expected it, and nothing returned it.
      sequences: [{ id: 1, code: 'SQ01', thumbnailUrl: null }],
      unsequencedShots: 4,
      total: 640,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
      hasMore: true,
    });
  });

  it('bounds the query and breaks sort ties by id', async () => {
    await request(app).get('/api/sequences?projectId=1');
    expect(db.sequence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: MAX_PAGE_SIZE,
        skip: 0,
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('lets the next page be read', async () => {
    await request(app).get('/api/sequences?projectId=1&page=2&pageSize=50');
    expect(db.sequence.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 50 }));
  });
});

describe('GET /api/tasks — page, project and board', () => {
  it("serves a shot's list with the standard envelope", async () => {
    const res = await request(app).get('/api/tasks?shotId=9&pageSize=250');
    expect(res.status).toBe(200);
    expect(tasks.list).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 250 }), 9, undefined);
  });

  it('serves the upload destinations with a wide page by default', async () => {
    // The previous behavior (500 tasks in one block) is kept; what changes is that the response now
    // says how many there are and where to resume.
    const res = await request(app).get('/api/tasks?projectId=1');
    expect(tasks.listForProject).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ pageSize: MAX_PAGE_SIZE }),
    );
    expect(res.body).toMatchObject({ tasks: [], total: 0, truncated: false, nextCursor: null });
  });

  it('passes the board cursor', async () => {
    const cursor = encodeCursor(0, 55);
    await request(app).get(`/api/tasks/board?projectId=1&limit=500&cursor=${encodeURIComponent(cursor)}`);
    expect(tasks.listForBoard).toHaveBeenCalledWith(1, 500, cursor);
  });

  it('without a cursor, the board behaves as before', async () => {
    await request(app).get('/api/tasks/board?projectId=1');
    expect(tasks.listForBoard).toHaveBeenCalledWith(1, undefined, undefined);
  });
});
