// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

/**
 * Contrat HTTP de la recherche globale : qui la demande, ce qu'elle accepte comme saisie,
 * et le fait que le rôle du demandeur descende bien jusqu'au moteur — c'est lui qui porte
 * le cloisonnement (cf. `lib/search.test.ts`).
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
  it('transmet la saisie, le demandeur et son rôle au moteur', async () => {
    const res = await request(app).get('/api/search?q=SH0120');
    expect(res.status).toBe(200);
    expect(search.searchEntities).toHaveBeenCalledWith('SH0120', 7, 'ARTIST');
  });

  it('rend les dix familles de résultats', async () => {
    const res = await request(app).get('/api/search?q=v012');
    expect(Object.keys(res.body as object).sort()).toEqual(Object.keys(EMPTY).sort());
  });

  it('refuse une saisie trop courte : un caractère ne discrimine rien', async () => {
    const res = await request(app).get('/api/search?q=a');
    expect(res.status).toBe(400);
    expect(search.searchEntities).not.toHaveBeenCalled();
  });

  it('refuse une saisie absente ou démesurée', async () => {
    expect((await request(app).get('/api/search')).status).toBe(400);
    expect((await request(app).get(`/api/search?q=${'x'.repeat(101)}`)).status).toBe(400);
    expect(search.searchEntities).not.toHaveBeenCalled();
  });

  it('rogne les espaces avant de compter les caractères', async () => {
    await request(app).get('/api/search?q=%20%20v012%20%20');
    expect(search.searchEntities).toHaveBeenCalledWith('v012', 7, 'ARTIST');
  });

  it('descend le rôle CLIENT tel quel — le moteur en dépend', async () => {
    session.user = { id: 12, role: 'CLIENT' };
    await request(app).get('/api/search?q=reflet');
    expect(search.searchEntities).toHaveBeenCalledWith('reflet', 12, 'CLIENT');
  });
});
