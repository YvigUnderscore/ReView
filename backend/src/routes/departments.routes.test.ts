// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A5-06 — le pipe d'un projet se lit comme le reste du projet.
 *
 * `GET /projects/:id/departments` servait la liste de n'importe quel projet à n'importe
 * quel compte authentifié, drapeau `writable` compris. La réponse est propre au projet ET
 * au lecteur : elle se filtre par appartenance, comme toute lecture de projet.
 *
 * Deuxième invariant figé ici : ce routeur est monté sur `/api` et ne doit JAMAIS poser
 * `router.use(authenticate)` — Express l'exécuterait pour toute requête traversant le
 * point de montage, partage client compris (401 au lieu de la page).
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

// Monté sur `/api`, comme en production : c'est ce montage qui interdit un
// `router.use(authenticate)` global.
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
  it("refuse le pipe d'un projet dont l'appelant n'est pas membre", async () => {
    const res = await request(app).get('/api/projects/3/departments');
    expect(res.status).toBe(403);
    expect(listForProjectWithRights).not.toHaveBeenCalled();
  });

  it("rend 404 sur un projet qui n'existe pas ou est à la corbeille", async () => {
    db.project.count.mockResolvedValue(0);
    const res = await request(app).get('/api/projects/999/departments');
    expect(res.status).toBe(404);
    expect(listForProjectWithRights).not.toHaveBeenCalled();
  });

  it('sert le pipe à un membre', async () => {
    db.projectMembership.findUnique.mockResolvedValue({ role: null });
    const res = await request(app).get('/api/projects/3/departments');
    expect(res.status).toBe(200);
    expect(listForProjectWithRights).toHaveBeenCalledWith(3, expect.objectContaining({ id: 7 }));
  });

  it('un SUPERVISOR garde son accès global', async () => {
    caller.user = { id: 2, email: 'sup@studio.com', role: 'SUPERVISOR' };
    const res = await request(app).get('/api/projects/3/departments');
    expect(res.status).toBe(200);
  });

  it('le référentiel du studio reste ouvert à tout compte authentifié', async () => {
    const res = await request(app).get('/api/departments');
    expect(res.status).toBe(200);
    expect(listForStudio).toHaveBeenCalledWith(1);
  });
});

/**
 * A5-03 — les trois écritures structurantes du pipe transmettent l'ACTEUR au service.
 *
 * Le journal d'audit ne peut nommer personne si la route garde `req.user` pour elle ;
 * renuméroter un pipe décide pourtant de « la dernière version » de tous ses plans.
 */
describe("écritures du pipe — l'acteur suit jusqu'au service", () => {
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
