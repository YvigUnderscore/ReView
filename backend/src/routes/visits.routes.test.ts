// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Visit acknowledgement (Phase 50, batch 9): what the route must never give up.
 *
 * A visit is personal data, but project access is still checked: acknowledging what one may not read
 * would confirm the entity's existence along the way. And "mark everything as read" accepts **no list
 * of ids**: the affected entities are determined in the database from the project alone, otherwise
 * membership of each id would have to be checked one query at a time.
 */
const { db, caller } = vi.hoisted(() => {
  // Annotated rather than cast: `as Request['user']` is a superfluous assertion in ESLint's eyes, which
  // removes it, and `role` then falls back to `string`.
  const caller: { user: Request['user'] } = {
    user: { id: 7, email: 'artist@studio.com', role: 'ARTIST' },
  };
  return {
    db: {
      project: { count: vi.fn(() => Promise.resolve(1)), findFirst: vi.fn(), findUnique: vi.fn() },
      projectMembership: { findUnique: vi.fn() },
      shot: { findUnique: vi.fn() },
    },
    caller,
  };
});

const { markVisited, markManyVisited, visitableIdsOfProject } = vi.hoisted(() => ({
  markVisited: vi.fn(),
  markManyVisited: vi.fn(),
  visitableIdsOfProject: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    next();
  },
}));
vi.mock('../services/EntityVisitService', () => ({
  markVisited,
  markManyVisited,
  visitableIdsOfProject,
}));

import express from 'express';
import request from 'supertest';
import visitsRoutes from './visits.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/visits', visitsRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  caller.user = { id: 7, email: 'artist@studio.com', role: 'ARTIST' };
  db.project.count.mockResolvedValue(1);
  db.projectMembership.findUnique.mockResolvedValue({ role: null });
  db.shot.findUnique.mockResolvedValue({ projectId: 3 });
  markVisited.mockResolvedValue(new Date('2026-09-20T10:00:00.000Z'));
  markManyVisited.mockResolvedValue(12);
  visitableIdsOfProject.mockResolvedValue([1, 2, 3]);
});

describe('POST /api/visits', () => {
  it("acknowledges a member's visit and returns the date", async () => {
    const res = await request(app).post('/api/visits').send({ targetType: 'SHOT', targetId: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ visitedAt: '2026-09-20T10:00:00.000Z' });
    expect(markVisited).toHaveBeenCalledWith(7, 'SHOT', 4);
  });

  it('refuses a shot from a project the caller is not a member of', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/visits').send({ targetType: 'SHOT', targetId: 4 });
    expect(res.status).toBe(403);
    expect(markVisited).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown target, writing nothing', async () => {
    db.shot.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/visits').send({ targetType: 'SHOT', targetId: 999 });
    expect(res.status).toBe(404);
    expect(markVisited).not.toHaveBeenCalled();
  });

  it('rejects a type it cannot authorize, instead of writing without a check', async () => {
    // `BOARD` exists in the model but has no project resolver: a plain 400.
    const res = await request(app).post('/api/visits').send({ targetType: 'BOARD', targetId: 4 });
    expect(res.status).toBe(400);
    expect(markVisited).not.toHaveBeenCalled();
  });
});

describe('POST /api/visits/mark-all', () => {
  it('determines the ids in the database, never from the request body', async () => {
    const res = await request(app)
      .post('/api/visits/mark-all')
      // Posted ids are ignored: the schema does not know them.
      .send({ targetType: 'SHOT', projectId: 3, ids: [999] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marked: 12 });
    expect(visitableIdsOfProject).toHaveBeenCalledWith(3, 'SHOT');
    expect(markManyVisited).toHaveBeenCalledWith(7, 'SHOT', [1, 2, 3]);
  });

  it('requires access to the project', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/visits/mark-all').send({ targetType: 'SHOT', projectId: 3 });
    expect(res.status).toBe(403);
    expect(markManyVisited).not.toHaveBeenCalled();
  });

  it('only accepts the three lists that carry the button', async () => {
    const res = await request(app).post('/api/visits/mark-all').send({ targetType: 'MEDIA', projectId: 3 });
    expect(res.status).toBe(400);
    expect(markManyVisited).not.toHaveBeenCalled();
  });
});
