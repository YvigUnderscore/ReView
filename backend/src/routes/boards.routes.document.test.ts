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
describe('PUT /api/boards — bounded document', () => {
  beforeEach(() => db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' }));

  it('rejects a document that does not have the expected shape', async () => {
    const res = await request(app)
      .put('/api/boards/project/42')
      .send({ document: { elements: 'nope' }, baseUpdatedAt: LOADED_AT });
    expect(res.status).toBe(400);
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a pasted image still in base64 beyond the inline ceiling', async () => {
    const files = {
      f1: { id: 'f1', mimeType: 'image/png', dataURL: `data:image/png;base64,${'A'.repeat(70_000)}` },
    };
    const res = await request(app)
      .put('/api/boards/project/42')
      .send({ document: { elements: [], files }, baseUpdatedAt: LOADED_AT });
    expect(res.status).toBe(400);
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('accepts an externalized image: the document carries only its id and type', async () => {
    const files = { f1: { id: 'f1', mimeType: 'image/png', created: 1 } };
    const res = await request(app)
      .put('/api/boards/project/42')
      .send({ document: { elements: [], files }, baseUpdatedAt: LOADED_AT });
    expect(res.status).toBe(200);
  });
});

/**
 * No concurrency control: two people on the same board silently overwrote each other.
 */
describe('PUT /api/boards — concurrency', () => {
  beforeEach(() => db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' }));

  it('requires the load timestamp: without it, no write', async () => {
    const res = await request(app).put('/api/boards/project/42').send({ document });
    expect(res.status).toBe(400);
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('responds 409 BOARD_CONFLICT with the current timestamp if someone saved in the meantime', async () => {
    const server = new Date('2026-08-22T12:00:00.000Z');
    db.board.updateMany.mockResolvedValue({ count: 0 });
    db.board.findUnique.mockResolvedValue({ id: 1, projectId: 42, document, updatedAt: server });
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BOARD_CONFLICT');
    expect(res.body.updatedAt).toBe(server.toISOString());
  });

  it('creates the board when the editor loaded it as nonexistent (baseUpdatedAt null)', async () => {
    const res = await request(app).put('/api/boards/project/42').send({ document, baseUpdatedAt: null });
    expect(res.status).toBe(200);
    expect(db.board.create).toHaveBeenCalled();
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });
});

/** Image uploads: same guard as the document write. */
describe('POST /api/boards/:scope/:id/files', () => {
  it('returns an upload URL per image', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    const res = await request(app)
      .post('/api/boards/project/42/files')
      .send({ files: [{ id: 'abc', mimeType: 'image/png' }] });
    expect(res.status).toBe(200);
    expect(res.body.uploads).toEqual([
      { id: 'abc', url: 'https://minio/put/projects/42/boards/project/abc' },
    ]);
  });

  it('rejects a CLIENT account', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    actor.current = { id: 7, role: Role.CLIENT };
    const res = await request(app)
      .post('/api/boards/project/42/files')
      .send({ files: [{ id: 'abc', mimeType: 'image/png' }] });
    expect(res.status).toBe(403);
  });

  it('rejects a forged file identifier', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    const res = await request(app)
      .post('/api/boards/project/42/files')
      .send({ files: [{ id: '../../avatars/1', mimeType: 'image/png' }] });
    expect(res.status).toBe(400);
  });
});

/** Reading signs access to the externalized images, otherwise the board opens empty. */
describe('GET /api/boards — image URLs', () => {
  it('returns the document together with read URLs for its files', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    db.board.findUnique.mockResolvedValue({
      id: 1,
      projectId: 42,
      document: { elements: [], files: { f1: { id: 'f1', mimeType: 'image/png' } } },
      updatedAt: new Date(LOADED_AT),
    });
    const res = await request(app).get('/api/boards/project/42');
    expect(res.status).toBe(200);
    expect(res.body.fileUrls).toEqual({ f1: 'https://minio/get/projects/42/boards/project/f1' });
  });
});
