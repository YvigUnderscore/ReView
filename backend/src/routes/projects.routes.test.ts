// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * A5-03 — les routes de membres transmettent l'ACTEUR au service.
 *
 * `ProjectService` accepte un acteur optionnel (la synchronisation ShotGrid appelle sans
 * session humaine) : une route qui oublierait `req.user` compilerait sans broncher et
 * poserait une trace anonyme, exactement le trou qu'on referme. Ce test le fige côté
 * route, là où le compilateur ne peut pas le faire.
 */
const { caller } = vi.hoisted(() => {
  const caller: { user: Request['user'] } = {
    user: { id: 5, email: 'sup@studio.com', role: 'SUPERVISOR' },
  };
  return { caller };
});

const { addMember, removeMember } = vi.hoisted(() => ({
  addMember: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    next();
  },
}));
vi.mock('../middleware/rbac', () => {
  const allow = (_req: Request, _res: Response, next: NextFunction) => next();
  return { requireRole: () => allow, requireProjectAccess: allow, requireProjectManage: allow };
});
vi.mock('../services/ProjectService', () => ({
  addMember,
  removeMember,
  listProjects: vi.fn(),
  createProject: vi.fn(),
  duplicateProject: vi.fn(),
  importCsv: vi.fn(),
  exportCsv: vi.fn(),
  getProject: vi.fn(),
  updateProject: vi.fn(),
  getProjectUsage: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  purge: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getActivity: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import projectRoutes from './projects.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/projects', projectRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  addMember.mockResolvedValue({ id: 1 });
  removeMember.mockResolvedValue(undefined);
});

describe('POST /api/projects/:projectId/members', () => {
  it("passe l'acteur au service, avec la cible et le rôle demandé", async () => {
    const res = await request(app).post('/api/projects/7/members').send({ userId: 42, role: 'CLIENT' });
    expect(res.status).toBe(201);
    expect(addMember).toHaveBeenCalledWith(7, 42, 'CLIENT', expect.objectContaining({ id: 5 }));
  });
});

describe('DELETE /api/projects/:projectId/members/:userId', () => {
  it("passe l'acteur au service", async () => {
    const res = await request(app).delete('/api/projects/7/members/42');
    expect(res.status).toBe(204);
    expect(removeMember).toHaveBeenCalledWith(7, 42, expect.objectContaining({ id: 5 }));
  });
});
