// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A1-07: `?projectId=` designates a project: it must be checked as such.
 *
 * A project's restricted vocabulary tells that it exists, whether it is linked (or not) to a ShotGrid
 * site, and what can be posted to it. Both routes served it for any identifier, to any authenticated
 * account, and, on the v1 side, to a token nonetheless confined to another project, which the tokens
 * screen promises to prevent.
 */
type Caller = { user: Request['user']; apiToken: Request['apiToken'] };

const { db, caller } = vi.hoisted(() => {
  const caller: Caller = { user: { id: 7, email: 'artist@studio.com', role: 'ARTIST' }, apiToken: undefined };
  return {
    db: {
      // The access guard starts by checking that the project exists and is not in the trash.
      project: { count: vi.fn(() => Promise.resolve(1)) },
      projectMembership: { findUnique: vi.fn() },
    },
    caller,
  };
});

const { listStatuses, listStatusesForProject } = vi.hoisted(() => ({
  listStatuses: vi.fn(),
  listStatusesForProject: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    req.apiToken = caller.apiToken;
    next();
  },
}));
vi.mock('../services/ReviewDecisionService', () => ({
  listStatuses,
  listStatusesForProject,
  createStatus: vi.fn(),
  updateStatus: vi.fn(),
  deleteStatus: vi.fn(),
  history: vi.fn(),
}));
vi.mock('../services/ReviewAssignmentService', async () => {
  const { z } = await import('zod');
  return {
    listReviewers: vi.fn(),
    setReviewers: vi.fn(),
    updateNote: vi.fn(),
    reviewersSchema: z.array(z.unknown()),
  };
});

import express from 'express';
import request from 'supertest';
import statusRoutes from './review-statuses.routes';
import v1ReviewRoutes from './v1/review.routes';
import { errorHandler } from '../middleware/error';

const app = express()
  .use(express.json())
  .use((req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    req.apiToken = caller.apiToken;
    next();
  })
  .use('/api/review-statuses', statusRoutes)
  .use('/api/v1', v1ReviewRoutes)
  .use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  caller.user = { id: 7, email: 'artist@studio.com', role: 'ARTIST' };
  caller.apiToken = undefined;
  db.project.count.mockResolvedValue(1);
  db.projectMembership.findUnique.mockResolvedValue(null);
  listStatuses.mockResolvedValue([{ id: 1, name: 'Approved' }]);
  listStatusesForProject.mockResolvedValue([{ id: 1, name: 'Approved' }]);
});

for (const path of ['/api/review-statuses', '/api/v1/review-statuses']) {
  describe(`GET ${path}?projectId= — filtering by membership`, () => {
    it('rejects a project the caller is not a member of', async () => {
      const res = await request(app).get(`${path}?projectId=3`);
      expect(res.status).toBe(403);
      expect(listStatusesForProject).not.toHaveBeenCalled();
    });

    it('returns 404 for a project that does not exist or is in the trash', async () => {
      db.project.count.mockResolvedValue(0);
      const res = await request(app).get(`${path}?projectId=999`);
      expect(res.status).toBe(404);
      expect(listStatusesForProject).not.toHaveBeenCalled();
    });

    it("serves the project's vocabulary to a member", async () => {
      db.projectMembership.findUnique.mockResolvedValue({ role: null });
      const res = await request(app).get(`${path}?projectId=3`);
      expect(res.status).toBe(200);
      expect(listStatusesForProject).toHaveBeenCalledWith(3);
    });

    it('without projectId: the studio catalog, unchanged', async () => {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(listStatuses).toHaveBeenCalled();
      expect(listStatusesForProject).not.toHaveBeenCalled();
    });
  });
}

describe('GET /api/v1/review-statuses — token confinement', () => {
  const adminWithToken = (projectId: number) => {
    caller.user = { id: 1, email: 'admin@studio.com', role: 'ADMIN' };
    caller.apiToken = { projectId, scopes: ['versions:read'] } as unknown as Request['apiToken'];
  };

  it('rejects a token confined to another project, even one held by an ADMIN', async () => {
    adminWithToken(42);
    const res = await request(app).get('/api/v1/review-statuses?projectId=3');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TOKEN_PROJECT_SCOPE');
    expect(listStatusesForProject).not.toHaveBeenCalled();
  });

  it('lets the token through on its own project', async () => {
    adminWithToken(3);
    const res = await request(app).get('/api/v1/review-statuses?projectId=3');
    expect(res.status).toBe(200);
    expect(listStatusesForProject).toHaveBeenCalledWith(3);
  });
});
