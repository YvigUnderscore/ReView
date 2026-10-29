// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A5-06: a project's pipe is read like the rest of the project.
 *
 * `GET /projects/:id/departments` served the list of any project to any authenticated account, the
 * `writable` flag included. The response is specific to the project AND to the reader: it is filtered
 * by membership, like any project read.
 *
 * Second invariant frozen here: this router is mounted on `/api` and must NEVER call
 * `router.use(authenticate)`: Express would run it for every request crossing the mount point, client
 * sharing included (401 instead of the page).
 */
const { db, caller } = vi.hoisted(() => {
  const caller: { user: Request['user'] } = {
    user: { id: 7, email: 'artist@studio.com', role: 'ARTIST' },
  };
  return {
    db: {
      project: { count: vi.fn(() => Promise.resolve(1)), findFirst: vi.fn(), findUnique: vi.fn() },
      projectMembership: { findUnique: vi.fn() },
    },
    caller,
  };
});

const { listForProjectWithRights, listForStudio, update, remove, reorder } = vi.hoisted(() => ({
  listForProjectWithRights: vi.fn(),
  listForStudio: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    next();
  },
}));
vi.mock('../services/DepartmentService', () => ({
  listForProjectWithRights,
  listForStudio,
  update,
  remove,
  reorder,
  create: vi.fn(),
  presignImage: vi.fn(),
  setImage: vi.fn(),
  setHolderDepartments: vi.fn(),
  attachHolderDepartments: vi.fn(),
  detachHolderDepartments: vi.fn(),
  setUserDepartments: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import departmentRoutes from './departments.routes';
import { errorHandler } from '../middleware/error';

// Mounted on `/api`, as in production: it is this mounting that forbids a global
// `router.use(authenticate)`.
const app = express().use(express.json()).use('/api', departmentRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  caller.user = { id: 7, email: 'artist@studio.com', role: 'ARTIST' };
  db.project.count.mockResolvedValue(1);
  db.projectMembership.findUnique.mockResolvedValue(null);
  db.project.findFirst.mockResolvedValue({ studioId: 1 });
  listForProjectWithRights.mockResolvedValue([{ id: 1, key: 'COMP', writable: true }]);
  listForStudio.mockResolvedValue([{ id: 1, key: 'COMP' }]);
});

describe('GET /api/projects/:projectId/departments', () => {
  it('refuses the pipe of a project the caller is not a member of', async () => {
    const res = await request(app).get('/api/projects/3/departments');
    expect(res.status).toBe(403);
    expect(listForProjectWithRights).not.toHaveBeenCalled();
  });

  it('returns 404 for a project that does not exist or is in the trash', async () => {
    db.project.count.mockResolvedValue(0);
    const res = await request(app).get('/api/projects/999/departments');
    expect(res.status).toBe(404);
    expect(listForProjectWithRights).not.toHaveBeenCalled();
  });

  it('serves the pipe to a member', async () => {
    db.projectMembership.findUnique.mockResolvedValue({ role: null });
    const res = await request(app).get('/api/projects/3/departments');
    expect(res.status).toBe(200);
    expect(listForProjectWithRights).toHaveBeenCalledWith(3, expect.objectContaining({ id: 7 }));
  });

  it('a SUPERVISOR keeps their global access', async () => {
    caller.user = { id: 2, email: 'sup@studio.com', role: 'SUPERVISOR' };
    const res = await request(app).get('/api/projects/3/departments');
    expect(res.status).toBe(200);
  });

  it('the studio catalog stays open to any authenticated account', async () => {
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(200);
    expect(listForStudio).toHaveBeenCalledWith(1);
  });
});

/**
 * A5-03: the three structuring writes of the pipe pass the ACTOR on to the service.
 *
 * The audit log cannot name anyone if the route keeps `req.user` to itself; yet renumbering a pipe
 * decides the "latest version" of all its shots.
 */
describe('pipe writes: the actor follows through to the service', () => {
  const supervisor = { id: 2, email: 'sup@studio.com', role: 'SUPERVISOR' as const };

  it('PATCH /departments/:id', async () => {
    caller.user = supervisor;
    update.mockResolvedValue({ id: 4 });
    const res = await request(app).patch('/api/departments/4').send({ name: 'Comp' });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), 4, { name: 'Comp' });
  });

  it('DELETE /departments/:id', async () => {
    caller.user = supervisor;
    const res = await request(app).delete('/api/departments/4');
    expect(res.status).toBe(204);
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), 4);
  });

  it('PUT /departments/order', async () => {
    caller.user = supervisor;
    const res = await request(app)
      .put('/api/departments/order')
      .send({ ids: [3, 1] });
    expect(res.status).toBe(204);
    expect(reorder).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), [3, 1]);
  });
});
