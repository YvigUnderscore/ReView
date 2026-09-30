// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

interface Actor {
  current: { id: number; role: string };
  apiToken?: { id: number };
}

const { ops, releases, backups, actor } = vi.hoisted(() => {
  const state: Actor = { current: { id: 1, role: 'ADMIN' } };
  return {
    ops: { overview: vi.fn(), updateMode: vi.fn() },
    releases: { catalog: vi.fn() },
    backups: { list: vi.fn() },
    actor: state,
  };
});

vi.mock('../services/OpsService', () => ops);
vi.mock('../services/ReleaseService', () => releases);
vi.mock('../services/BackupCatalogService', () => backups);
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = actor.current as Request['user'];
    req.apiToken = actor.apiToken as Request['apiToken'];
    next();
  },
}));
// Le limiteur s'appuie sur Redis ; ce qu'on vérifie ici est le contrat de la route.
vi.mock('../middleware/rateLimit', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  identityRateKey: () => 'test',
}));

import express from 'express';
import request from 'supertest';
import adminOpsRoutes from './admin-ops.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/admin/ops', adminOpsRoutes).use(errorHandler);

const OVERVIEW = {
  current: { version: '2.3.0', commit: 'abc123', builtAt: null, node: 'v22.11.0', source: 'https://…' },
  mode: 'registry',
  latest: { tag: 'v2.4.0' },
  newer: [{ tag: 'v2.4.0' }],
  release: { checkedAt: '2026-09-10T14:00:00Z', error: null },
  updateAvailable: true,
  backups: { available: true, dir: '/backups', entries: [] },
  commands: { update: 'bash scripts/update.sh --version v2.4.0', backup: 'bash scripts/backup.sh' },
};

beforeEach(() => {
  vi.clearAllMocks();
  actor.current = { id: 1, role: 'ADMIN' };
  actor.apiToken = undefined;
  ops.overview.mockResolvedValue(OVERVIEW);
  releases.catalog.mockResolvedValue({ releases: [], checkedAt: null, error: null });
  backups.list.mockResolvedValue({ available: false, dir: null, entries: [] });
});

describe('GET /api/admin/ops', () => {
  it('sert l’état complet à un admin', async () => {
    const res = await request(app).get('/api/admin/ops');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(OVERVIEW);
  });

  it('refuse un rôle qui n’administre pas le studio', async () => {
    for (const role of ['SUPERVISOR', 'ARTIST', 'CLIENT']) {
      actor.current = { id: 2, role };
      expect((await request(app).get('/api/admin/ops')).status, role).toBe(403);
    }
    expect(ops.overview).not.toHaveBeenCalled();
  });

  it('refuse un jeton d’API, même porteur du rôle admin', async () => {
    // Une ferme de rendu écrit des versions ; elle n'exploite pas l'instance. Le jour où
    // cette base porte l'exécution, c'est cette ligne qui empêche un jeton fuité de
    // commander une bascule sans personne devant l'écran.
    actor.apiToken = { id: 7 };
    const res = await request(app).get('/api/admin/ops');
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('API_TOKEN_FORBIDDEN');
  });

  it('reste 200 quand GitHub est injoignable — l’écran doit rester lisible', async () => {
    ops.overview.mockResolvedValue({
      ...OVERVIEW,
      latest: null,
      newer: [],
      updateAvailable: false,
      release: { checkedAt: null, error: 'UNREACHABLE' },
    });
    const res = await request(app).get('/api/admin/ops');
    expect(res.status).toBe(200);
    expect(res.body.release.error).toBe('UNREACHABLE');
  });
});

describe('catalogue et sauvegardes', () => {
  it('sert le catalogue des releases', async () => {
    releases.catalog.mockResolvedValue({ releases: [{ tag: 'v2.4.0' }], checkedAt: 'x', error: null });
    const res = await request(app).get('/api/admin/ops/releases');
    expect(res.status).toBe(200);
    expect(res.body.releases).toEqual([{ tag: 'v2.4.0' }]);
    expect(releases.catalog).toHaveBeenCalledWith();
  });

  it('« vérifier maintenant » contourne le cache', async () => {
    releases.catalog.mockResolvedValue({ releases: [], checkedAt: 'x', error: null });
    expect((await request(app).post('/api/admin/ops/releases/refresh')).status).toBe(200);
    expect(releases.catalog).toHaveBeenCalledWith({ force: true });
  });

  it('sert le catalogue des sauvegardes', async () => {
    backups.list.mockResolvedValue({
      available: true,
      dir: '/backups',
      entries: [{ id: '20260910-030000' }],
    });
    const res = await request(app).get('/api/admin/ops/backups');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
  });
});
