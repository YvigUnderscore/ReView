// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The default layouts of the overview, one per role.
 *
 * Two requirements hold the route: a setting for one role must never erase that of another (all four
 * live in the same `Setting` row), and an unreadable layout in the database must not prevent the page
 * from opening.
 */

const { db } = vi.hoisted(() => ({
  db: {
    setting: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 1, role: 'ADMIN', email: 'a@b.c' };
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));

import express from 'express';
import request from 'supertest';
import overviewLayoutRoutes from './overview-layout.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/studio', overviewLayoutRoutes).use(errorHandler);

/** The transaction is only a frame: the test runs the body on the same fake client. */
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.setting.upsert.mockResolvedValue({});
});

const stored = (value: string | null) =>
  db.setting.findUnique.mockResolvedValue(value === null ? null : { key: 'x', value });

describe('GET /api/studio/overview-layout', () => {
  it('returns the saved defaults', async () => {
    stored(JSON.stringify({ ARTIST: { hidden: ['counts'] } }));
    const res = await request(app).get('/api/studio/overview-layout');
    expect(res.status).toBe(200);
    expect(res.body.defaults).toEqual({ ARTIST: { hidden: ['counts'] } });
  });

  it('returns an empty map when nothing has ever been set', async () => {
    stored(null);
    const res = await request(app).get('/api/studio/overview-layout');
    expect(res.body.defaults).toEqual({});
  });

  it('ignores an unreadable setting rather than breaking the page', async () => {
    // Broken JSON, then valid JSON citing a block that no longer exists in the product: in both
    // cases the page must open on the shipped layout, not on an error.
    stored('{ pas du json');
    expect((await request(app).get('/api/studio/overview-layout')).body.defaults).toEqual({});
    stored(JSON.stringify({ ARTIST: { order: ['bloc-disparu'] } }));
    expect((await request(app).get('/api/studio/overview-layout')).body.defaults).toEqual({});
  });
});

describe('PUT /api/studio/overview-layout', () => {
  it("saves a role's default without touching the others", async () => {
    stored(JSON.stringify({ SUPERVISOR: { hidden: ['counts'] } }));
    const res = await request(app)
      .put('/api/studio/overview-layout')
      .send({ role: 'ARTIST', layout: { order: ['myTasks', 'activity'] } });
    expect(res.status).toBe(200);
    expect(res.body.defaults).toEqual({
      SUPERVISOR: { hidden: ['counts'] },
      ARTIST: { order: ['myTasks', 'activity'] },
    });
    const upsert = db.setting.upsert.mock.calls[0]?.[0] as { update: { value: string } } | undefined;
    expect(JSON.parse(upsert?.update.value ?? '{}')).toEqual(res.body.defaults);
  });

  it("removes a role's default with a null layout", async () => {
    stored(JSON.stringify({ ARTIST: { hidden: ['counts'] }, CLIENT: { hidden: ['tasks'] } }));
    const res = await request(app).put('/api/studio/overview-layout').send({ role: 'ARTIST', layout: null });
    expect(res.body.defaults).toEqual({ CLIENT: { hidden: ['tasks'] } });
  });

  it('rejects a layout citing an unknown block', async () => {
    stored(null);
    const res = await request(app)
      .put('/api/studio/overview-layout')
      .send({ role: 'ARTIST', layout: { order: ['fantome'] } });
    expect(res.status).toBe(400);
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown role', async () => {
    stored(null);
    const res = await request(app).put('/api/studio/overview-layout').send({ role: 'PRODUCER', layout: {} });
    expect(res.status).toBe(400);
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });
});
