// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * PERF-06: contract of the schedule window. The route took no parameter: the client could not ask for
 * less than the whole project. It now accepts two optional bounds, and passes them through as they are
 * to the service.
 */

vi.mock('../services/ScheduleService', () => ({
  getProjectSchedule: vi.fn(() => Promise.resolve({ tasks: [], truncated: false, limit: 2000 })),
}));
vi.mock('../services/StatsService', () => ({ getProjectStats: vi.fn() }));
vi.mock('../services/ProductionService', () => ({ getOverview: vi.fn() }));
vi.mock('../services/GridService', () => ({
  getProjectGrid: vi.fn(() => Promise.resolve({})),
  GRID_MAX_LIMIT: 200,
}));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, role: 'ADMIN' } as Request['user'];
    next();
  },
}));
/**
 * The guard is that of project MANAGEMENT, not of simple membership: the tab exposes named workloads,
 * delays and unassigned tasks. The test replaces it with a switch to verify both outcomes without
 * mounting the whole RBAC.
 */
let manageAllowed = true;
vi.mock('../middleware/rbac', () => ({
  requireProjectManage: (_req: Request, res: Response, next: NextFunction) => {
    if (manageAllowed) return next();
    res.status(403).json({ error: 'Managing the project is reserved to supervisors' });
  },
}));

import express from 'express';
import request from 'supertest';
import productionRoutes from './production.routes';
import * as ScheduleService from '../services/ScheduleService';
import * as GridService from '../services/GridService';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/projects', productionRoutes).use(errorHandler);
const getSchedule = vi.mocked(ScheduleService.getProjectSchedule);

beforeEach(() => {
  vi.clearAllMocks();
  manageAllowed = true;
});

describe('GET /api/projects/:projectId/schedule', () => {
  it('without bounds, requests the whole schedule: the previous contract is intact', async () => {
    const res = await request(app).get('/api/projects/7/schedule');
    expect(res.status).toBe(200);
    expect(getSchedule).toHaveBeenCalledWith(7, { from: undefined, to: undefined });
  });

  it('passes the requested window on, converted to dates', async () => {
    const res = await request(app).get('/api/projects/7/schedule?from=2026-09-01&to=2026-12-01');
    expect(res.status).toBe(200);
    expect(getSchedule).toHaveBeenCalledWith(7, {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    });
  });

  it('accepts a single bound', async () => {
    await request(app).get('/api/projects/7/schedule?from=2026-09-01');
    expect(getSchedule).toHaveBeenCalledWith(7, {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: undefined,
    });
  });

  it('rejects an unreadable bound rather than ignoring it', async () => {
    const res = await request(app).get('/api/projects/7/schedule?to=la-semaine-prochaine');
    expect(res.status).toBe(400);
    expect(getSchedule).not.toHaveBeenCalled();
  });

  it('returns the ceiling and the truncation state to the reader', async () => {
    getSchedule.mockResolvedValue({ tasks: [], truncated: true, limit: 2000 });
    const res = await request(app).get('/api/projects/7/schedule');
    expect(res.body).toEqual({ tasks: [], truncated: true, limit: 2000 });
  });
});

describe('GET /api/projects/:projectId/grid', () => {
  it('serves the default page with no filter', async () => {
    const res = await request(app).get('/api/projects/7/grid');
    expect(res.status).toBe(200);
    expect(vi.mocked(GridService.getProjectGrid)).toHaveBeenCalledWith(7, {});
  });

  it('passes the cursor, the ceiling and the five filters on, converted to numbers', async () => {
    await request(app).get(
      '/api/projects/7/grid?cursor=abc&limit=120&episodeId=5&sequenceId=3&department=comp&assigneeId=9&status=ip',
    );
    expect(vi.mocked(GridService.getProjectGrid)).toHaveBeenCalledWith(7, {
      cursor: 'abc',
      limit: 120,
      episodeId: 5,
      sequenceId: 3,
      department: 'comp',
      assigneeId: 9,
      status: 'ip',
    });
  });

  it('rejects an out-of-range ceiling rather than silently trimming it', async () => {
    const res = await request(app).get('/api/projects/7/grid?limit=5000');
    expect(res.status).toBe(400);
    expect(vi.mocked(GridService.getProjectGrid)).not.toHaveBeenCalled();
  });

  it('rejects an unreadable sequence identifier', async () => {
    expect((await request(app).get('/api/projects/7/grid?sequenceId=abc')).status).toBe(400);
  });
});

describe('Production — read rights', () => {
  /** The four reads of the tab, all reserved to whoever manages the project. */
  const paths = [
    '/api/projects/7/grid',
    '/api/projects/7/production',
    '/api/projects/7/schedule',
    '/api/projects/7/stats',
  ];

  it('rejects the four reads to whoever does not manage the project, CLIENT included', async () => {
    manageAllowed = false;
    for (const path of paths) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(403);
    }
    // No service is reached: the refusal precedes the read, it does not filter it afterwards.
    expect(vi.mocked(GridService.getProjectGrid)).not.toHaveBeenCalled();
    expect(getSchedule).not.toHaveBeenCalled();
  });

  it('lets through whoever manages the project', async () => {
    for (const path of paths) expect((await request(app).get(path)).status, path).toBe(200);
  });
});
