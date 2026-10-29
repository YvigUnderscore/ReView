// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { access, manage, resolveShot, resolveAsset, create } = vi.hoisted(() => ({
  access: vi.fn(),
  manage: vi.fn(),
  resolveShot: vi.fn(),
  resolveAsset: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    // GLOBAL artist role: this is the case that decides here: the person may very well supervise that
    // project through their membership.
    req.user = { id: 42, role: 'ARTIST', email: 'a@b.c' };
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({ assertProjectAccess: access }));
vi.mock('../lib/projectRoles', () => ({ assertProjectManage: manage }));
vi.mock('../lib/pipeline', () => ({
  resolveProjectIdForTask: vi.fn(),
  resolveProjectIdForShot: resolveShot,
  resolveProjectIdForAsset: resolveAsset,
}));
vi.mock('../services/TaskService', () => ({
  create,
  listForBoard: vi.fn(),
  list: vi.fn(),
  listForProject: vi.fn(),
  getDetail: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import tasksRoutes from './tasks.routes';
import { errorHandler } from '../middleware/error';
import { forbidden } from '../lib/errors';

const app = express().use(express.json()).use('/api/tasks', tasksRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue(undefined);
  manage.mockResolvedValue(undefined);
  resolveShot.mockResolvedValue(461);
  resolveAsset.mockResolvedValue(461);
  create.mockResolvedValue({ id: 7, name: 'ANIM', department: 'ANIM' });
});

/**
 * Creating a task does not require ShotGrid: it is the only path available to a standalone project. The
 * check nonetheless read the account's GLOBAL role: a lead supervising their project through membership
 * was refused the creation, and their pipe stayed empty for lack of a remote site to feed it.
 */
describe('POST /api/tasks — rights read on the effective role', () => {
  it('accepts a project supervisor whose global role is ARTIST', async () => {
    const res = await request(app).post('/api/tasks').send({ name: 'ANIM', shotId: 12 });
    expect(res.status).toBe(201);
    expect(manage).toHaveBeenCalledWith(42, 'ARTIST', 461);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      461,
      expect.objectContaining({ name: 'ANIM', shotId: 12 }),
    );
  });

  it('rejects when the effective role does not manage the project', async () => {
    manage.mockRejectedValue(forbidden('Managing the project is reserved to supervisors'));
    const res = await request(app).post('/api/tasks').send({ name: 'ANIM', assetId: 5 });
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('checks project membership before management rights', async () => {
    access.mockRejectedValue(forbidden('No access to this project'));
    const res = await request(app).post('/api/tasks').send({ name: 'ANIM', shotId: 12 });
    expect(res.status).toBe(403);
    expect(manage).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a missing parent before any rights check', async () => {
    resolveShot.mockResolvedValue(null);
    const res = await request(app).post('/api/tasks').send({ name: 'ANIM', shotId: 999 });
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it('requires exactly one parent: neither both nor none', async () => {
    const both = await request(app).post('/api/tasks').send({ name: 'ANIM', shotId: 1, assetId: 2 });
    const none = await request(app).post('/api/tasks').send({ name: 'ANIM' });
    expect(both.status).toBe(400);
    expect(none.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
