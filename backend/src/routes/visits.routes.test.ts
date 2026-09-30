// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Acquittement de visite (Phase 50, lot 9) — ce que la route ne doit jamais céder.
 *
 * Une visite est une donnée personnelle, mais l'accès au projet se vérifie quand même :
 * acquitter ce qu'on n'a pas le droit de lire confirmerait au passage l'existence de
 * l'entité. Et « tout marquer comme lu » n'accepte **aucune liste d'ids** — les entités
 * concernées sont établies en base à partir du seul projet, faute de quoi il aurait fallu
 * vérifier l'appartenance de chaque id, une requête à la fois.
 */
const { db, caller } = vi.hoisted(() => {
  // Annoté plutôt que casté : `as Request['user']` est une assertion superflue aux yeux
  // d'ESLint, qui la retire — et `role` retombe alors sur `string`.
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
vi.mock('../middleware/auth', () => ({
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
  it('acquitte la visite d’un membre et rend la date', async () => {
    const res = await request(app).post('/api/visits').send({ targetType: 'SHOT', targetId: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ visitedAt: '2026-09-20T10:00:00.000Z' });
    expect(markVisited).toHaveBeenCalledWith(7, 'SHOT', 4);
  });

  it('refuse le plan d’un projet dont l’appelant n’est pas membre', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/visits').send({ targetType: 'SHOT', targetId: 4 });
    expect(res.status).toBe(403);
    expect(markVisited).not.toHaveBeenCalled();
  });

  it('rend 404 sur une cible introuvable, sans rien écrire', async () => {
    db.shot.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/visits').send({ targetType: 'SHOT', targetId: 999 });
    expect(res.status).toBe(404);
    expect(markVisited).not.toHaveBeenCalled();
  });

  it('rejette un type qu’on ne sait pas autoriser plutôt que d’écrire sans contrôle', async () => {
    // `BOARD` existe côté modèle mais n'a pas de résolveur de projet : 400 franc.
    const res = await request(app).post('/api/visits').send({ targetType: 'BOARD', targetId: 4 });
    expect(res.status).toBe(400);
    expect(markVisited).not.toHaveBeenCalled();
  });
});

describe('POST /api/visits/mark-all', () => {
  it('établit les ids en base — jamais depuis le corps de la requête', async () => {
    const res = await request(app)
      .post('/api/visits/mark-all')
      // Les ids postés sont ignorés : le schéma ne les connaît pas.
      .send({ targetType: 'SHOT', projectId: 3, ids: [999] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marked: 12 });
    expect(visitableIdsOfProject).toHaveBeenCalledWith(3, 'SHOT');
    expect(markManyVisited).toHaveBeenCalledWith(7, 'SHOT', [1, 2, 3]);
  });

  it('exige l’accès au projet', async () => {
    db.projectMembership.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/api/visits/mark-all').send({ targetType: 'SHOT', projectId: 3 });
    expect(res.status).toBe(403);
    expect(markManyVisited).not.toHaveBeenCalled();
  });

  it('n’accepte que les trois listes qui portent le bouton', async () => {
    const res = await request(app).post('/api/visits/mark-all').send({ targetType: 'MEDIA', projectId: 3 });
    expect(res.status).toBe(400);
    expect(markManyVisited).not.toHaveBeenCalled();
  });
});
