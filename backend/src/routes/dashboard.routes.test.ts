// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

/**
 * Les deux vues transverses servies sous `/api/dashboard` : « mes tâches » et le fil des
 * commentaires. Ce sont les destinations des compteurs de l'Accueil — un compteur qui ouvre
 * une route absente ou refusée ne valait pas mieux que l'ancienne ancre morte.
 *
 * Le routeur est monté sur `/api/dashboard` et non sur `/api` : son `router.use(authenticate)`
 * ne traverse donc aucune route publique.
 */
const { caller } = vi.hoisted(() => ({
  caller: { user: { id: 3, email: 'artist@studio.com', role: 'ARTIST' as const } },
}));

const { listMyTasks, listMyComments, getDashboard } = vi.hoisted(() => ({
  listMyTasks: vi.fn(),
  listMyComments: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    next();
  },
}));
vi.mock('../services/MyWorkService', () => ({ listMyTasks, listMyComments }));
vi.mock('../services/DashboardService', () => ({ getDashboard }));

import express from 'express';
import request from 'supertest';
import dashboardRoutes from './dashboard.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/dashboard', dashboardRoutes).use(errorHandler);

const empty = { items: [], total: 0, page: 1, pageSize: 100, pageCount: 1, hasMore: false };

beforeEach(() => {
  vi.clearAllMocks();
  listMyTasks.mockResolvedValue(empty);
  listMyComments.mockResolvedValue(empty);
  getDashboard.mockResolvedValue({ stats: {} });
});

describe('GET /api/dashboard/tasks', () => {
  it('sert toutes mes tâches quand aucun périmètre n’est demandé', async () => {
    const res = await request(app).get('/api/dashboard/tasks');
    expect(res.status).toBe(200);
    expect(listMyTasks).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3 }),
      'all',
      expect.objectContaining({ page: 1 }),
    );
  });

  it('déplie le compteur de retakes sur scope=blocked', async () => {
    const res = await request(app).get('/api/dashboard/tasks?scope=blocked');
    expect(res.status).toBe(200);
    expect(listMyTasks.mock.calls[0]![1]).toBe('blocked');
  });

  it('refuse un périmètre inventé plutôt que de l’interpréter', async () => {
    const res = await request(app).get('/api/dashboard/tasks?scope=everything');
    expect(res.status).toBe(400);
    expect(listMyTasks).not.toHaveBeenCalled();
  });

  it('refuse une page plus grande que le plafond des listes', async () => {
    const res = await request(app).get('/api/dashboard/tasks?pageSize=5000');
    expect(res.status).toBe(400);
    expect(listMyTasks).not.toHaveBeenCalled();
  });
});

describe('GET /api/dashboard/comments', () => {
  it('sert le fil, paginé comme les autres listes', async () => {
    const res = await request(app).get('/api/dashboard/comments?pageSize=10');
    expect(res.status).toBe(200);
    expect(listMyComments).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3 }),
      expect.objectContaining({ pageSize: 10 }),
    );
  });
});
