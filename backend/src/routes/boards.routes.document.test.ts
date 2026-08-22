// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';

const { db, actor } = vi.hoisted(() => ({
  db: {
    project: { findFirst: vi.fn() },
    projectMembership: { findUnique: vi.fn() },
    asset: { findUnique: vi.fn() },
    board: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    // Présent exprès : si le code se remettait à journaliser, le test 3 le verrait.
    boardChange: { create: vi.fn() },
  },
  // `vi.hoisted` court avant les imports : pas de `Role.ARTIST` ici, la valeur n'existe pas encore.
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
/** Corps d'une sauvegarde d'éditeur : le document et l'horodatage sur lequel il a chargé. */
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
describe('PUT /api/boards — document borné', () => {
  beforeEach(() => db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' }));

  it('refuse un document qui n’a pas la forme attendue', async () => {
    const res = await request(app)
      .put('/api/boards/project/42')
      .send({ document: { elements: 'nope' }, baseUpdatedAt: LOADED_AT });
    expect(res.status).toBe(400);
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('refuse une image collée restée en base64 au-delà du plafond inline', async () => {
    const files = {
      f1: { id: 'f1', mimeType: 'image/png', dataURL: `data:image/png;base64,${'A'.repeat(70_000)}` },
    };
    const res = await request(app)
      .put('/api/boards/project/42')
      .send({ document: { elements: [], files }, baseUpdatedAt: LOADED_AT });
    expect(res.status).toBe(400);
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('accepte une image externalisée : le document ne porte que son id et son type', async () => {
    const files = { f1: { id: 'f1', mimeType: 'image/png', created: 1 } };
    const res = await request(app)
      .put('/api/boards/project/42')
      .send({ document: { elements: [], files }, baseUpdatedAt: LOADED_AT });
    expect(res.status).toBe(200);
  });
});

/**
 * Aucun contrôle de concurrence : deux personnes sur le même board s'écrasaient en silence.
 */
describe('PUT /api/boards — concurrence', () => {
  beforeEach(() => db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' }));

  it('exige l’horodatage de chargement — sans lui, pas d’écriture', async () => {
    const res = await request(app).put('/api/boards/project/42').send({ document });
    expect(res.status).toBe(400);
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('répond 409 BOARD_CONFLICT avec l’horodatage courant si quelqu’un a sauvegardé entre-temps', async () => {
    const server = new Date('2026-08-22T12:00:00.000Z');
    db.board.updateMany.mockResolvedValue({ count: 0 });
    db.board.findUnique.mockResolvedValue({ id: 1, projectId: 42, document, updatedAt: server });
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BOARD_CONFLICT');
    expect(res.body.updatedAt).toBe(server.toISOString());
  });

  it('crée le board quand l’éditeur l’a chargé inexistant (baseUpdatedAt null)', async () => {
    const res = await request(app).put('/api/boards/project/42').send({ document, baseUpdatedAt: null });
    expect(res.status).toBe(200);
    expect(db.board.create).toHaveBeenCalled();
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });
});

/** Dépôt des images : même garde que l'écriture du document. */
describe('POST /api/boards/:scope/:id/files', () => {
  it('rend une URL de dépôt par image', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    const res = await request(app)
      .post('/api/boards/project/42/files')
      .send({ files: [{ id: 'abc', mimeType: 'image/png' }] });
    expect(res.status).toBe(200);
    expect(res.body.uploads).toEqual([
      { id: 'abc', url: 'https://minio/put/projects/42/boards/project/abc' },
    ]);
  });

  it('refuse un compte CLIENT', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    actor.current = { id: 7, role: Role.CLIENT };
    const res = await request(app)
      .post('/api/boards/project/42/files')
      .send({ files: [{ id: 'abc', mimeType: 'image/png' }] });
    expect(res.status).toBe(403);
  });

  it('refuse un identifiant de fichier fabriqué', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    const res = await request(app)
      .post('/api/boards/project/42/files')
      .send({ files: [{ id: '../../avatars/1', mimeType: 'image/png' }] });
    expect(res.status).toBe(400);
  });
});

/** La lecture signe l'accès aux images externalisées — sinon le board s'ouvre vide. */
describe('GET /api/boards — URL des images', () => {
  it('accompagne le document des URL de lecture de ses fichiers', async () => {
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
