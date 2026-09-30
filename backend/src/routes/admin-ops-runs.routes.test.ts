// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

interface Actor {
  current: { id: number; email: string; role: string };
  apiToken?: { id: number };
}

const { spool, releases, tokens, audit, actor } = vi.hoisted(() => {
  const state: Actor = { current: { id: 3, email: 'ops@studio.tld', role: 'ADMIN' } };
  return {
    spool: {
      mechanism: vi.fn(),
      enqueue: vi.fn(),
      cancel: vi.fn(),
      listRuns: vi.fn(),
      readRun: vi.fn(),
      readLog: vi.fn(),
    },
    releases: { isPublishedTag: vi.fn() },
    tokens: { assertActorPassword: vi.fn() },
    audit: { logAudit: vi.fn() },
    actor: state,
  };
});

vi.mock('../services/OpsSpoolService', () => spool);
vi.mock('../services/ReleaseService', () => releases);
vi.mock('../services/ApiTokenService', () => tokens);
vi.mock('../services/AuditService', () => audit);
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    req.user = actor.current as Request['user'];
    req.apiToken = actor.apiToken as Request['apiToken'];
    next();
  },
}));
vi.mock('../middleware/rateLimit', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  identityRateKey: () => 'test',
}));

import express from 'express';
import request from 'supertest';
import adminOpsRunsRoutes from './admin-ops-runs.routes';
import { errorHandler } from '../middleware/error';
import { forbidden } from '../lib/errors';

const app = express().use(express.json()).use('/api/admin/ops', adminOpsRunsRoutes).use(errorHandler);

const READY = {
  state: 'ready',
  reason: null,
  protocol: 1,
  agentVersion: '2.4.0',
  seenAt: 'x',
  allow: { update: true, backup: true, verify: true },
};
const RUN = { id: '20260910-142233-a1b2c3', kind: 'update', state: 'queued', cancellable: true };
const UPDATE = { kind: 'update', version: 'v2.4.0', currentPassword: 'Motdepasse1' };
const code = (body: { error?: { code?: string }; code?: string }) => body.error?.code ?? body.code;

beforeEach(() => {
  vi.clearAllMocks();
  actor.current = { id: 3, email: 'ops@studio.tld', role: 'ADMIN' };
  actor.apiToken = undefined;
  spool.mechanism.mockResolvedValue(READY);
  spool.enqueue.mockResolvedValue(undefined);
  spool.readRun.mockResolvedValue(RUN);
  spool.listRuns.mockResolvedValue([RUN]);
  spool.readLog.mockResolvedValue({ from: 0, next: 12, text: 'salut', truncated: false });
  releases.isPublishedTag.mockResolvedValue(true);
  tokens.assertActorPassword.mockResolvedValue(undefined);
});

describe('POST /api/admin/ops/runs', () => {
  it('commande une mise à jour et rend 202', async () => {
    const res = await request(app).post('/api/admin/ops/runs').send(UPDATE);
    expect(res.status).toBe(202);
    expect(spool.enqueue).toHaveBeenCalledTimes(1);
    const order = spool.enqueue.mock.calls[0]?.[0] as { kind: string; params: { version: string } };
    expect(order.kind).toBe('update');
    expect(order.params.version).toBe('v2.4.0');
  });

  it('trace AVANT de déposer l’ordre', async () => {
    // Une opération qui tourne mal est précisément celle dont on veut savoir qui l'a
    // lancée : une trace posée à la fin manquerait toutes celles qui n'y arrivent pas.
    const calls: string[] = [];
    audit.logAudit.mockImplementation(() => calls.push('audit'));
    spool.enqueue.mockImplementation(() => {
      calls.push('enqueue');
      return Promise.resolve();
    });
    await request(app).post('/api/admin/ops/runs').send(UPDATE);
    expect(calls).toEqual(['audit', 'enqueue']);
  });

  it('exige le mot de passe de l’admin', async () => {
    tokens.assertActorPassword.mockRejectedValue(forbidden('Invalid password'));
    const res = await request(app).post('/api/admin/ops/runs').send(UPDATE);
    expect(res.status).toBe(403);
    expect(spool.enqueue).not.toHaveBeenCalled();
  });

  it('refuse une étiquette qui n’a pas la forme d’une étiquette, sans rien demander à personne', async () => {
    for (const version of ['v2.4.0; rm -rf /', 'latest', '../../etc', '-v2.4.0']) {
      const res = await request(app)
        .post('/api/admin/ops/runs')
        .send({ ...UPDATE, version });
      expect(res.status, version).toBe(400);
    }
    expect(releases.isPublishedTag).not.toHaveBeenCalled();
    expect(spool.enqueue).not.toHaveBeenCalled();
  });

  it('refuse une étiquette bien formée mais jamais publiée', async () => {
    releases.isPublishedTag.mockResolvedValue(false);
    const res = await request(app)
      .post('/api/admin/ops/runs')
      .send({ ...UPDATE, version: 'v9.9.9' });
    expect(res.status).toBe(400);
    expect(code(res.body)).toBe('RELEASE_UNKNOWN');
  });

  it('exige une version pour une mise à jour, un identifiant pour une vérification', async () => {
    expect(
      (await request(app).post('/api/admin/ops/runs').send({ kind: 'update', currentPassword: 'x' })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/admin/ops/runs').send({ kind: 'verify', currentPassword: 'x' })).status,
    ).toBe(400);
  });

  it('refuse quand une opération tourne déjà', async () => {
    spool.mechanism.mockResolvedValue({ ...READY, state: 'busy' });
    const res = await request(app).post('/api/admin/ops/runs').send(UPDATE);
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('OPS_BUSY');
  });

  it('refuse quand l’agent est absent, muet ou bloqué', async () => {
    for (const state of ['absent', 'stalled', 'blocked']) {
      spool.mechanism.mockResolvedValue({ ...READY, state, reason: 'ROOT_MISMATCH' });
      const res = await request(app).post('/api/admin/ops/runs').send(UPDATE);
      expect(res.status, state).toBe(409);
      expect(code(res.body), state).toBe('OPS_UNAVAILABLE');
    }
  });

  it('respecte ce que l’exploitant a refusé dans la configuration de l’agent', async () => {
    // `deploy/agent.conf` n'est monté dans aucun conteneur de l'application : c'est la
    // barrière qu'une session d'administration volée ne franchit pas.
    spool.mechanism.mockResolvedValue({ ...READY, allow: { update: false, backup: true, verify: true } });
    const res = await request(app).post('/api/admin/ops/runs').send(UPDATE);
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('OPS_NOT_ALLOWED');
  });

  it('refuse un jeton d’API et un rôle non admin', async () => {
    actor.apiToken = { id: 7 };
    expect((await request(app).post('/api/admin/ops/runs').send(UPDATE)).status).toBe(400);
    actor.apiToken = undefined;
    actor.current = { id: 4, email: 'a@b.c', role: 'SUPERVISOR' };
    expect((await request(app).post('/api/admin/ops/runs').send(UPDATE)).status).toBe(403);
    expect(spool.enqueue).not.toHaveBeenCalled();
  });
});

describe('suivi et annulation', () => {
  it('sert l’état et une tranche de journal', async () => {
    const res = await request(app).get(`/api/admin/ops/runs/${RUN.id}?from=12`);
    expect(res.status).toBe(200);
    expect(res.body.log.text).toBe('salut');
    expect(spool.readLog).toHaveBeenCalledWith(RUN.id, 12);
  });

  it('refuse un identifiant qui n’en est pas un, avant de toucher au disque', async () => {
    expect((await request(app).get('/api/admin/ops/runs/..%2F..%2Fetc')).status).toBe(400);
    expect(spool.readRun).not.toHaveBeenCalled();
  });

  it('rend 404 sur une exécution inconnue', async () => {
    spool.readRun.mockResolvedValue(null);
    expect((await request(app).get(`/api/admin/ops/runs/${RUN.id}`)).status).toBe(404);
  });

  it('annule tant que la bascule n’est pas engagée, et refuse ensuite', async () => {
    expect((await request(app).post(`/api/admin/ops/runs/${RUN.id}/cancel`)).status).toBe(202);
    expect(spool.cancel).toHaveBeenCalledWith(RUN.id);

    spool.readRun.mockResolvedValue({ ...RUN, state: 'running', cancellable: false });
    const res = await request(app).post(`/api/admin/ops/runs/${RUN.id}/cancel`);
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('OPS_RUN_FINISHED');
  });
});
