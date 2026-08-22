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

/**
 * Verrou d'archivage (38.B) — un projet ARCHIVED est en lecture seule. Le board était la
 * seule écriture de contenu à passer au travers : elle vérifiait l'accès au projet et
 * refusait les CLIENT, mais n'appelait pas `assertProjectWritable`.
 */
describe('PUT /api/boards — verrou d’archivage', () => {
  it('sauvegarde le board d’un projet ACTIVE', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(200);
    expect(db.board.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 42, updatedAt: new Date(LOADED_AT) } }),
    );
  });

  it('refuse la sauvegarde sur un projet ARCHIVED (403 PROJECT_ARCHIVED) sans rien écrire', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ARCHIVED' });
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('refuse aussi le board d’un asset dont le projet est ARCHIVED', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ARCHIVED' });
    const res = await request(app).put('/api/boards/asset/5').send(save);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PROJECT_ARCHIVED');
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });

  it('laisse lire le board d’un projet ARCHIVED — archivé vaut lecture seule, pas invisible', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ARCHIVED' });
    const res = await request(app).get('/api/boards/project/42');
    expect(res.status).toBe(200);
    expect(res.body.board.document).toEqual(document);
  });

  it('refuse toujours les comptes CLIENT sur un projet ACTIVE', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    actor.current = { id: 7, role: Role.CLIENT };
    const res = await request(app).put('/api/boards/project/42').send(save);
    expect(res.status).toBe(403);
    expect(db.board.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * Le journal `BoardChange` écrivait une ligne à chaque autosave (1,2 s de débounce) et
 * n'était relu par rien : modèle et table retirés.
 */
describe('PUT /api/boards — plus de journal de modifications', () => {
  it('n’écrit aucune ligne de journal en sauvegardant', async () => {
    db.project.findFirst.mockResolvedValue({ status: 'ACTIVE' });
    await request(app).put('/api/boards/project/42').send(save);
    expect(db.boardChange.create).not.toHaveBeenCalled();
  });
});

/**
 * Le document valait `z.any()` sous une limite de corps de 2 Mo : deux captures collées
 * suffisaient à faire répondre 413 à chaque autosave, sans message exploitable.
 */
