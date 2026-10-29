// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * HTTP contract of the global search: who requests it, what it accepts as input, and the fact that the
 * requester's role goes all the way down to the engine. It is the role that carries the segregation
 * (cf. `lib/search.test.ts`).
 */

const { search, session } = vi.hoisted(() => ({
  search: { searchEntities: vi.fn() },
  session: { user: { id: 7, role: 'ARTIST' } },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = session.user as Request['user'];
    next();
  },
}));
vi.mock('../middleware/rateLimit', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  identityRateKey: () => 'test',
}));
vi.mock('../lib/search', () => search);

import express from 'express';
import request from 'supertest';
import searchRoutes from './search.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/search', searchRoutes).use(errorHandler);

const EMPTY = {
  projects: [],
  sequences: [],
  shots: [],
  assets: [],
  tasks: [],
  versions: [],
  media: [],
  playlists: [],
  comments: [],
  people: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  session.user = { id: 7, role: 'ARTIST' };
  search.searchEntities.mockResolvedValue(EMPTY);
});

describe('GET /api/search', () => {
  it('passes the input, the requester and their role on to the engine', async () => {
    const res = await request(app).get('/api/search?q=SH0120');
    expect(res.status).toBe(200);
    expect(search.searchEntities).toHaveBeenCalledWith('SH0120', 7, 'ARTIST');
  });

  it('returns the ten result families', async () => {
    const res = await request(app).get('/api/search?q=v012');
    expect(Object.keys(res.body as object).sort()).toEqual(Object.keys(EMPTY).sort());
  });

  it('rejects an input that is too short: one character discriminates nothing', async () => {
    const res = await request(app).get('/api/search?q=a');
    expect(res.status).toBe(400);
    expect(search.searchEntities).not.toHaveBeenCalled();
  });

  it('rejects a missing or oversized input', async () => {
    expect((await request(app).get('/api/search')).status).toBe(400);
    expect((await request(app).get(`/api/search?q=${'x'.repeat(101)}`)).status).toBe(400);
    expect(search.searchEntities).not.toHaveBeenCalled();
  });

  it('trims spaces before counting characters', async () => {
    await request(app).get('/api/search?q=%20%20v012%20%20');
    expect(search.searchEntities).toHaveBeenCalledWith('v012', 7, 'ARTIST');
  });

  it('passes the CLIENT role down unchanged: the engine depends on it', async () => {
    session.user = { id: 12, role: 'CLIENT' };
    await request(app).get('/api/search?q=reflet');
    expect(search.searchEntities).toHaveBeenCalledWith('reflet', 12, 'CLIENT');
  });
});
