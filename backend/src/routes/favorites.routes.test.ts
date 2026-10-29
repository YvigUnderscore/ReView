// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const { svc, rbac, caller } = vi.hoisted(() => {
  const caller: { user: Request['user'] } = { user: { id: 7, email: 'a@b.c', role: 'ARTIST' } };
  return {
    svc: {
      listFavorites: vi.fn(),
      projectIdForEntity: vi.fn(),
      addFavorite: vi.fn(),
      removeFavorite: vi.fn(),
    },
    rbac: { assertProjectAccess: vi.fn() },
    caller,
  };
});

vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = caller.user;
    next();
  },
}));
vi.mock('../middleware/rbac', () => rbac);
vi.mock('../services/FavoriteService', () => svc);

import express from 'express';
import request from 'supertest';
import favoritesRoutes from './favorites.routes';
import { errorHandler } from '../middleware/error';
import { forbidden } from '../lib/errors';

const app = express().use(express.json()).use('/api/favorites', favoritesRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  rbac.assertProjectAccess.mockResolvedValue(undefined);
});

describe('favorites routes', () => {
  it('GET lists the caller favorites', async () => {
    svc.listFavorites.mockResolvedValue([{ id: 1 }]);
    const res = await request(app).get('/api/favorites');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ favorites: [{ id: 1 }] });
    expect(svc.listFavorites).toHaveBeenCalledWith(caller.user);
  });

  it('POST checks project access before storing', async () => {
    svc.projectIdForEntity.mockResolvedValue(3);
    svc.addFavorite.mockResolvedValue({ id: 9 });
    const res = await request(app).post('/api/favorites').send({ type: 'SHOT', entityId: 4 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ favorite: { id: 9 } });
    expect(rbac.assertProjectAccess).toHaveBeenCalledWith(expect.anything(), 3);
    expect(svc.addFavorite).toHaveBeenCalledWith(7, 'SHOT', 4);
  });

  it('POST on an unknown entity is a 404, on a foreign project a 403', async () => {
    svc.projectIdForEntity.mockResolvedValue(null);
    expect((await request(app).post('/api/favorites').send({ type: 'SHOT', entityId: 4 })).status).toBe(404);
    svc.projectIdForEntity.mockResolvedValue(3);
    rbac.assertProjectAccess.mockRejectedValue(forbidden());
    expect((await request(app).post('/api/favorites').send({ type: 'SHOT', entityId: 4 })).status).toBe(403);
    expect(svc.addFavorite).not.toHaveBeenCalled();
  });

  it('POST validates the body', async () => {
    expect((await request(app).post('/api/favorites').send({ type: 'NOPE', entityId: 4 })).status).toBe(400);
  });

  it('DELETE removes the caller favorite', async () => {
    const res = await request(app).delete('/api/favorites/SHOT/4');
    expect(res.status).toBe(204);
    expect(svc.removeFavorite).toHaveBeenCalledWith(7, 'SHOT', 4);
  });
});
