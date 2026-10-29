// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';

const { db, actor } = vi.hoisted(() => ({
  db: {
    // `count`: the project access guard starts by checking that the project is not in the trash
    // (`middleware/rbac`). It never is in this file.
    project: { findFirst: vi.fn(), count: vi.fn(() => Promise.resolve(1)) },
    projectMembership: { findUnique: vi.fn() },
    asset: { findUnique: vi.fn() },
    board: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    // Present on purpose: if the code started logging again, test 3 would see it.
    boardChange: { create: vi.fn() },
  },
  // `vi.hoisted` runs before the imports: no `Role.ARTIST` here, the value does not exist yet.
  actor: { current: { id: 7, role: 'ARTIST' } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../services/SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../services/StorageService', () => ({
  storage: {
    getPresignedGetUrl: vi.fn((key: string) => Promise.resolve(`https://minio/get/${key}`)),
    getPresignedPutUrl: vi.fn((key: string) => Promise.resolve(`https://minio/put/${key}`)),
    forgetPresignedUrl: vi.fn(),
  },
}));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = actor.current as Request['user'];
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import boardsRoutes from './boards.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/boards', boardsRoutes).use(errorHandler);

const document = { elements: [{ id: 'a', type: 'rectangle' }], files: {} };
const LOADED_AT = '2026-08-22T10:00:00.000Z';
/** Body of an editor save: the document and the timestamp it was loaded at. */
const save = { document, baseUpdatedAt: LOADED_AT };

beforeEach(() => {
  vi.clearAllMocks();
  actor.current = { id: 7, role: Role.ARTIST };
  db.projectMembership.findUnique.mockResolvedValue({ userId: 7, projectId: 42 });
  db.asset.findUnique.mockResolvedValue({ projectId: 42 });
  db.board.findUnique.mockResolvedValue({
    id: 1,
    projectId: 42,
    document,
    updatedAt: new Date(LOADED_AT),
  });
  db.board.updateMany.mockResolvedValue({ count: 1 });
  db.board.create.mockResolvedValue({ id: 1, projectId: 42, document, updatedAt: new Date(LOADED_AT) });
});

/**
 * Archive lock (38.B): an ARCHIVED project is read-only. The board was the only content write to slip
 * through: it checked project access and refused CLIENTs, but did not call `assertProjectWritable`.
 */
describe('PUT /api/boards — archive lock', () => {
  it('saves the board of an ACTIVE project', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(200);
    expect(db.board.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 42, updatedAt: new Date(LOADED_AT) } }),
    );
  });

  it('refuses the save on an ARCHIVED project (403 PROJECT_ARCHIVED) without writing anything', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ARCHIVED' });
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('also refuses the board of an asset whose project is ARCHIVED', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ARCHIVED' });
    const res = await request(app).put('/api/boards/asset/5').send(save);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('lets the board of an ARCHIVED project be read: archived means read-only, not invisible', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ARCHIVED' });
    const res = await request(app).get('/api/boards/project/42');
    expect(res.status).toBe(200);
    expect(res.body.board.document).toEqual(document);
  });

  it('still refuses CLIENT accounts on an ACTIVE project', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    actor.current = { id: 7, role: Role.CLIENT };
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(403);
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * A1-03: the write guard read the GLOBAL role (`req.user.role === CLIENT`), whereas
 * `assertProjectAccess` only checks the existence of the membership. An ARTIST demoted to CLIENT on
 * the project (38.E) therefore wrote the board as before.
 */
describe('PUT /api/boards — effective role per project (38.E)', () => {
  beforeEach(() => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    // Global ARTIST (cf. `actor.current`), demoted to CLIENT on project 42.
    db.projectMembership.findUnique.mockResolvedValue({ userId: 7, projectId: 42, role: Role.CLIENT });
  });

  it('refuses writing to an ARTIST demoted to CLIENT (403 ROLE_FORBIDDEN)', async () => {
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ROLE_FORBIDDEN');
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('also refuses image presigning, which is a write', async () => {
    const res = await request(app)
      .post('/api/boards/project/42/files')
      .send({ files: [{ id: 'a1b2c3d4', mimeType: 'image/png' }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ROLE_FORBIDDEN');
  });

  it('leaves them read access: demoting removes the write, not the access to the project', async () => {
    const res = await request(app).get('/api/boards/project/42');
    expect(res.status).toBe(200);
    expect(res.body.board.document).toEqual(document);
  });

  it('conversely: an ARTIST promoted to SUPERVISOR locally writes the board', async () => {
    db.projectMembership.findUnique.mockResolvedValue({
      userId: 7,
      projectId: 42,
      role: Role.SUPERVISOR,
    });
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(200);
  });
});

/**
 * The `BoardChange` log wrote a line on every autosave (1.2 s debounce) and nothing read it:
 * the model and the table were removed.
 */
describe('PUT /api/boards — no more change log', () => {
  it('writes no log line when saving', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    await request(app).put('/api/boards/project/42').send(save);
    expect(db.boardChange.create).not.toHaveBeenCalled();
  });
});

/**
 * The document was `z.any()` under a 2 MB body limit: two pasted captures were enough to make every
 * autosave answer 413, with no usable message.
 */
