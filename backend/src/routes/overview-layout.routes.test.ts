// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Les dispositions par défaut de la vue d'ensemble, une par rôle.
 *
 * Deux exigences tiennent la route : un réglage d'un rôle ne doit jamais effacer celui
 * d'un autre (les quatre vivent dans la même ligne de `Setting`), et une disposition
 * illisible en base ne doit pas empêcher la page de s'ouvrir.
 */

const { db } = vi.hoisted(() => ({
  db: {
    setting: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
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
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));

import express from 'express';
import request from 'supertest';
import overviewLayoutRoutes from './overview-layout.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/studio', overviewLayoutRoutes).use(errorHandler);

/** La transaction n'est qu'un cadre : le test exécute le corps sur le même faux client. */
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.setting.upsert.mockResolvedValue({});
});

const stored = (value: string | null) =>
  db.setting.findUnique.mockResolvedValue(value === null ? null : { key: 'x', value });

describe('GET /api/studio/overview-layout', () => {
  it('rend les défauts enregistrés', async () => {
    stored(JSON.stringify({ ARTIST: { hidden: ['counts'] } }));
    const res = await request(app).get('/api/studio/overview-layout');
    expect(res.status).toBe(200);
    expect(res.body.defaults).toEqual({ ARTIST: { hidden: ['counts'] } });
  });

  it('rend une carte vide quand rien n’a jamais été réglé', async () => {
    stored(null);
    const res = await request(app).get('/api/studio/overview-layout');
    expect(res.body.defaults).toEqual({});
  });

  it('ignore un réglage illisible plutôt que de casser la page', async () => {
    // JSON cassé, puis JSON valide mais citant un bloc disparu du produit : dans les deux
    // cas la page doit s'ouvrir sur la disposition livrée, pas sur une erreur.
    stored('{ pas du json');
    expect((await request(app).get('/api/studio/overview-layout')).body.defaults).toEqual({});
    stored(JSON.stringify({ ARTIST: { order: ['bloc-disparu'] } }));
    expect((await request(app).get('/api/studio/overview-layout')).body.defaults).toEqual({});
  });
});

describe('PUT /api/studio/overview-layout', () => {
  it('enregistre le défaut d’un rôle sans toucher aux autres', async () => {
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

  it('retire le défaut d’un rôle avec une disposition nulle', async () => {
    stored(JSON.stringify({ ARTIST: { hidden: ['counts'] }, CLIENT: { hidden: ['tasks'] } }));
    const res = await request(app).put('/api/studio/overview-layout').send({ role: 'ARTIST', layout: null });
    expect(res.body.defaults).toEqual({ CLIENT: { hidden: ['tasks'] } });
  });

  it('refuse une disposition citant un bloc inconnu', async () => {
    stored(null);
    const res = await request(app)
      .put('/api/studio/overview-layout')
      .send({ role: 'ARTIST', layout: { order: ['fantome'] } });
    expect(res.status).toBe(400);
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });

  it('refuse un rôle inconnu', async () => {
    stored(null);
    const res = await request(app).put('/api/studio/overview-layout').send({ role: 'PRODUCER', layout: {} });
    expect(res.status).toBe(400);
    expect(db.setting.upsert).not.toHaveBeenCalled();
  });
});
