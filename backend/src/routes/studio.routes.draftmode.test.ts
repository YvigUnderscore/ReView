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
vi.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 1, role: 'ADMIN', email: 'a@b.c' };
    next();
  },
}));
vi.mock('../middleware/rbac', () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../services/StorageService', () => ({ storage: { getPresignedGetUrl: vi.fn() } }));
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
 * Le mode brouillon (Phase 50) est un réglage de studio, et il a deux lecteurs : l'écran
 * d'administration, qui l'écrit, et TOUT LE MONDE, qui a besoin de savoir si « publier » est
 * encore un geste. Le second passe par l'identité publique du studio — le seul canal ouvert
 * à un artiste. Ce fichier verrouille les deux bouts, et la forme de la valeur écrite.
 */
describe('GET /api/studio/branding — le mode brouillon voyage avec l’identité publique', () => {
  it('rend `draftMode: false` quand le réglage n’existe pas (publication d’office)', async () => {
    const res = await request(app).get('/api/studio/branding');

    expect(res.status).toBe(200);
    expect(res.body.draftMode).toBe(false);
  });

  it('rend `draftMode: true` quand le studio a gardé le parcours en deux temps', async () => {
    db.setting.findUnique.mockImplementation((args: { where: { key: string } }) =>
      args.where.key === SETTING_KEYS.DRAFT_MODE ? { value: 'true' } : null,
    );

    const res = await request(app).get('/api/studio/branding');

    expect(res.body.draftMode).toBe(true);
  });
});

describe('PUT /api/studio/settings — la valeur d’un réglage booléen est contrainte', () => {
  it('accepte « true » et « false »', async () => {
    for (const value of ['true', 'false']) {
      const res = await request(app).put('/api/studio/settings').send({ key: 'draftMode', value });
      expect(res.status).toBe(200);
    }
    expect(db.setting.upsert).toHaveBeenCalledTimes(2);
  });

  it('refuse toute autre valeur, sans rien écrire', async () => {
    for (const value of ['oui', '1', 'True', '']) {
      const res = await request(app).put('/api/studio/settings').send({ key: 'draftMode', value });
      expect(res.status).toBe(400);
    }
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });

  it('laisse les autres réglages libres : la contrainte ne vise que les booléens', async () => {
    const res = await request(app)
      .put('/api/studio/settings')
      .send({ key: 'max_file_size', value: '8589934592' });

    expect(res.status).toBe(200);
  });
});
