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
// The rate limiter relies on Redis; what is verified here is the route's contract.
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
  it('serves the full state to an admin', async () => {
    const res = await request(app).get('/api/admin/ops');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(OVERVIEW);
  });

  it('refuses a role that does not administer the studio', async () => {
    for (const role of ['SUPERVISOR', 'ARTIST', 'CLIENT']) {
      actor.current = { id: 2, role };
      expect((await request(app).get('/api/admin/ops')).status, role).toBe(403);
    }
    expect(ops.overview).not.toHaveBeenCalled();
  });

  it('refuses an API token, even one carrying the admin role', async () => {
    // A render farm writes versions; it does not run the instance. The day this database carries the
    // execution, this line is what prevents a leaked token from ordering a switchover with nobody in
    // front of the screen.
    actor.apiToken = { id: 7 };
    const res = await request(app).get('/api/admin/ops');
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('API_TOKEN_FORBIDDEN');
  });

  it('stays 200 when GitHub is unreachable: the screen must stay readable', async () => {
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

describe('catalog and backups', () => {
  it('serves the release catalog', async () => {
    releases.catalog.mockResolvedValue({ releases: [{ tag: 'v2.4.0' }], checkedAt: 'x', error: null });
    const res = await request(app).get('/api/admin/ops/releases');
    expect(res.status).toBe(200);
    expect(res.body.releases).toEqual([{ tag: 'v2.4.0' }]);
    expect(releases.catalog).toHaveBeenCalledWith();
  });

  it('"check now" bypasses the cache', async () => {
    releases.catalog.mockResolvedValue({ releases: [], checkedAt: 'x', error: null });
    expect((await request(app).post('/api/admin/ops/releases/refresh')).status).toBe(200);
    expect(releases.catalog).toHaveBeenCalledWith({ force: true });
  });

  it('serves the backup catalog', async () => {
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
