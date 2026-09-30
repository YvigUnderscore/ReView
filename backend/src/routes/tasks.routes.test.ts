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

vi.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    // Rôle GLOBAL d'artiste : c'est le cas qui décide ici — la personne peut très bien
    // superviser ce projet-là par son membership.
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
 * Créer une tâche ne demande pas ShotGrid — c'est le seul chemin dont dispose un projet
 * autonome. Le contrôle portait pourtant sur le rôle **global** du compte : un lead
 * supervisant son projet par membership se voyait refuser la création, et son pipe restait
 * vide faute de site distant pour l'alimenter.
 */
describe('POST /api/tasks — droits lus sur le rôle effectif', () => {
  it('accepte un superviseur de projet dont le rôle global est ARTIST', async () => {
    const res = await request(app).post('/api/tasks').send({ name: 'ANIM', shotId: 12 });
    expect(res.status).toBe(201);
    expect(manage).toHaveBeenCalledWith(42, 'ARTIST', 461);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      461,
      expect.objectContaining({ name: 'ANIM', shotId: 12 }),
    );
  });

  it('refuse quand le rôle effectif ne gère pas le projet', async () => {
    manage.mockRejectedValue(forbidden('Managing the project is reserved to supervisors'));
    const res = await request(app).post('/api/tasks').send({ name: 'ANIM', assetId: 5 });
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('vérifie l’appartenance au projet avant les droits de gestion', async () => {
    access.mockRejectedValue(forbidden('No access to this project'));
    const res = await request(app).post('/api/tasks').send({ name: 'ANIM', shotId: 12 });
    expect(res.status).toBe(403);
    expect(manage).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuse un parent absent avant tout contrôle de droits', async () => {
    resolveShot.mockResolvedValue(null);
    const res = await request(app).post('/api/tasks').send({ name: 'ANIM', shotId: 999 });
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it('exige exactement un parent — ni les deux, ni aucun', async () => {
    const both = await request(app).post('/api/tasks').send({ name: 'ANIM', shotId: 1, assetId: 2 });
    const none = await request(app).post('/api/tasks').send({ name: 'ANIM' });
    expect(both.status).toBe(400);
    expect(none.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
