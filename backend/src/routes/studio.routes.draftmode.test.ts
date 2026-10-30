// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    studio: { findFirst: vi.fn(), update: vi.fn() },
    setting: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
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
vi.mock('../lib/storage', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn(), list: vi.fn() }));
vi.mock('../lib/loginAppearance', () => ({
  getLoginAppearance: vi.fn(() => Promise.resolve({ bgKey: null })),
  loginBgUrl: vi.fn(() => Promise.resolve(null)),
}));

import express from 'express';
import request from 'supertest';
import studioRoutes from './studio.routes';
import { errorHandler } from '../middleware/error';
import { SETTING_KEYS } from '../lib/settings';

const app = express().use(express.json()).use('/api/studio', studioRoutes).use(errorHandler);

beforeEach(() => {
  vi.clearAllMocks();
  db.studio.findFirst.mockResolvedValue({ id: 1, name: 'Studio IT' });
  db.setting.findUnique.mockResolvedValue(null);
  db.setting.upsert.mockImplementation((args: { where: { key: string } }) => ({
    key: args.where.key,
    value: 'true',
  }));
});

/**
 * Draft mode (Phase 50) is a studio setting, and it has two readers: the administration screen, which
 * writes it, and EVERYONE, who needs to know whether "publish" is still a gesture. The second goes
 * through the studio's public identity, the only channel open to an artist. This file locks down both
 * ends, and the shape of the value written.
 */
describe('GET /api/studio/branding — draft mode travels with the public identity', () => {
  it('returns `draftMode: false` when the setting does not exist (publication by default)', async () => {
    const res = await request(app).get('/api/studio/branding');

    expect(res.status).toBe(200);
    expect(res.body.draftMode).toBe(false);
  });

  it('returns `draftMode: true` when the studio has kept the two-step path', async () => {
    db.setting.findUnique.mockImplementation((args: { where: { key: string } }) =>
      args.where.key === SETTING_KEYS.DRAFT_MODE ? { value: 'true' } : null,
    );

    const res = await request(app).get('/api/studio/branding');

    expect(res.body.draftMode).toBe(true);
  });
});

describe('PUT /api/studio/settings — the value of a boolean setting is constrained', () => {
  it('accepts "true" and "false"', async () => {
    for (const value of ['true', 'false']) {
      const res = await request(app).put('/api/studio/settings').send({ key: 'draftMode', value });
      expect(res.status).toBe(200);
    }
    expect(db.setting.upsert).toHaveBeenCalledTimes(2);
  });

  it('rejects any other value, without writing anything', async () => {
    for (const value of ['oui', '1', 'True', '']) {
      const res = await request(app).put('/api/studio/settings').send({ key: 'draftMode', value });
      expect(res.status).toBe(400);
    }
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });

  it('leaves other settings free: the constraint only targets booleans', async () => {
    const res = await request(app)
      .put('/api/studio/settings')
      .send({ key: 'max_file_size', value: '8589934592' });

    expect(res.status).toBe(200);
  });
});
