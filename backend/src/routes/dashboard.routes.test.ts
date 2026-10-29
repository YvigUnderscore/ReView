// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

/**
 * The two cross-cutting views served under `/api/dashboard`: "my tasks" and the comments feed. They
 * are the destinations of the Home counters: a counter that opens a missing or refused route was no
 * better than the former dead anchor.
 *
 * The router is mounted on `/api/dashboard` and not on `/api`: its `router.use(authenticate)` therefore
 * does not cross any public route.
 */
const { caller } = vi.hoisted(() => ({
  caller: { user: { id: 3, email: 'artist@studio.com', role: 'ARTIST' as const } },
}));

const { listMyTasks, listMyComments, getDashboard } = vi.hoisted(() => ({
  listMyTasks: vi.fn(),
  listMyComments: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    next();
  },
}));
vi.mock('../services/MyWorkService', () => ({ listMyTasks, listMyComments }));
vi.mock('../services/DashboardService', () => ({ getDashboard }));

import express from 'express';
import request from 'supertest';
import dashboardRoutes from './dashboard.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/dashboard', dashboardRoutes).use(errorHandler);

const empty = { items: [], total: 0, page: 1, pageSize: 100, pageCount: 1, hasMore: false };

beforeEach(() => {
  vi.clearAllMocks();
  listMyTasks.mockResolvedValue(empty);
  listMyComments.mockResolvedValue(empty);
  getDashboard.mockResolvedValue({ stats: {} });
});

describe('GET /api/dashboard/tasks', () => {
  it('serves all my tasks when no scope is requested', async () => {
    const res = await request(app).get('/api/dashboard/tasks');
    expect(res.status).toBe(200);
    // The fourth argument is the project filter (batch 10): when absent, the list stays cross-project,
    // which is what the Home counters unfold.
    expect(listMyTasks).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3 }),
      'all',
      expect.objectContaining({ page: 1 }),
      undefined,
    );
  });

  it('restricts the list to one project for the overview block', async () => {
    const res = await request(app).get('/api/dashboard/tasks?projectId=12');
    expect(res.status).toBe(200);
    expect(listMyTasks.mock.calls[0]![3]).toBe(12);
  });

  it('rejects a project that is not an identifier', async () => {
    const res = await request(app).get('/api/dashboard/tasks?projectId=zero');
    expect(res.status).toBe(400);
    expect(listMyTasks).not.toHaveBeenCalled();
  });

  it('unfolds the retake counter on scope=blocked', async () => {
    const res = await request(app).get('/api/dashboard/tasks?scope=blocked');
    expect(res.status).toBe(200);
    expect(listMyTasks.mock.calls[0]![1]).toBe('blocked');
  });

  it('rejects an invented scope rather than interpreting it', async () => {
    const res = await request(app).get('/api/dashboard/tasks?scope=everything');
    expect(res.status).toBe(400);
    expect(listMyTasks).not.toHaveBeenCalled();
  });

  it('rejects a page larger than the list ceiling', async () => {
    const res = await request(app).get('/api/dashboard/tasks?pageSize=5000');
    expect(res.status).toBe(400);
    expect(listMyTasks).not.toHaveBeenCalled();
  });
});

describe('GET /api/dashboard/comments', () => {
  it('serves the feed, paginated like the other lists', async () => {
    const res = await request(app).get('/api/dashboard/comments?pageSize=10');
    expect(res.status).toBe(200);
    expect(listMyComments).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3 }),
      expect.objectContaining({ pageSize: 10 }),
    );
  });
});
