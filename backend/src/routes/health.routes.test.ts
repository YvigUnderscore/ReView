// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { db, redisCall, storagePing } = vi.hoisted(() => ({
  db: { $queryRaw: vi.fn() },
  redisCall: vi.fn(),
  storagePing: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/redis', () => ({ getRedis: () => ({ call: redisCall }) }));
vi.mock('../services/StorageService', () => ({ storage: { ping: storagePing } }));
vi.mock('../lib/settings', () => ({
  getSourceUrl: vi.fn().mockResolvedValue('https://git.studio.tld/review'),
}));

import express from 'express';
import request from 'supertest';
import healthRoutes, {
  buildHealthRouter,
  createReadinessCache,
  failureReason,
  runChecks,
  timedCheck,
  versionRouter,
  type ReadinessReport,
} from './health.routes';

const app = express().use('/health', healthRoutes).use('/api/version', versionRouter);

beforeEach(() => {
  vi.clearAllMocks();
  db.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  redisCall.mockResolvedValue('PONG');
  storagePing.mockResolvedValue(true);
});

/**
 * La vivacité ne doit jamais dépendre d'une dépendance : redémarrer le conteneur d'API
 * parce que Postgres est tombé ajoute une panne à la panne.
 */
describe('GET /health — vivacité', () => {
  it('répond sans toucher base, Redis ni stockage', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(redisCall).not.toHaveBeenCalled();
    expect(storagePing).not.toHaveBeenCalled();
  });

  it('annonce la version de l’instance', async () => {
    const res = await request(app).get('/health');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version).not.toBe('');
    expect(typeof res.body.uptimeSec).toBe('number');
  });

  it('expose le même contenu sur /health/live', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /health/ready — disponibilité', () => {
  it('interroge les trois dépendances, répond 200, puis sert le résultat mémorisé', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database.ok).toBe(true);
    expect(res.body.checks.redis.ok).toBe(true);
    expect(res.body.checks.storage.ok).toBe(true);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redisCall).toHaveBeenCalledWith('PING');
    expect(storagePing).toHaveBeenCalledTimes(1);

    // Sonde suivante dans la fenêtre de mémorisation : aucune dépendance n'est retouchée.
    const again = await request(app).get('/health/ready');
    expect(again.body.cached).toBe(true);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('répond 503 dès qu’une dépendance manque (un frontal doit pouvoir le lire)', async () => {
    const degraded = express().use(
      '/health',
      buildHealthRouter({
        database: () => Promise.resolve(1),
        redis: () => Promise.reject(new Error('connection refused')),
      }),
    );
    const res = await request(degraded).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.redis.ok).toBe(false);
    expect(res.body.checks.database.ok).toBe(true);
  });
});

describe('GET /api/version', () => {
  it('publie version, runtime et URL des sources (AGPL §13)', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('https://git.studio.tld/review');
    expect(res.body.node).toBe(process.version);
    expect(res.body).toHaveProperty('commit');
    expect(res.body).toHaveProperty('builtAt');
  });
});

describe('timedCheck', () => {
  it('rapporte un succès avec sa durée', async () => {
    let clock = 1_000;
    const result = await timedCheck(
      () => Promise.resolve('ok'),
      50,
      () => (clock += 5),
    );
    expect(result.ok).toBe(true);
    expect(result.ms).toBe(5);
  });

  it('échoue proprement au lieu de pendre quand la dépendance ne répond jamais', async () => {
    const result = await timedCheck(() => new Promise(() => undefined), 10);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('borne le motif d’échec (un message brut peut porter une URL de connexion)', () => {
    expect(failureReason(new Error('x'.repeat(500)))).toHaveLength(120);
    expect(failureReason('pas une erreur')).toBe('unavailable');
  });
});

describe('runChecks', () => {
  it('déclare l’ensemble indisponible dès qu’un contrôle échoue', async () => {
    const report = await runChecks(
      {
        up: () => Promise.resolve(1),
        down: () => Promise.reject(new Error('connection refused')),
      },
      50,
    );
    expect(report.ok).toBe(false);
    expect(report.checks.up?.ok).toBe(true);
    expect(report.checks.down?.error).toBe('connection refused');
  });
});

describe('createReadinessCache', () => {
  const ok: ReadinessReport = { ok: true, checks: {} };

  it('regroupe les appels concurrents en une seule exécution', async () => {
    const run = vi.fn().mockResolvedValue(ok);
    const cached = createReadinessCache(run, 1_000);
    await Promise.all([cached(), cached(), cached()]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('réinterroge une fois le délai de validité écoulé', async () => {
    let clock = 0;
    const run = vi.fn().mockResolvedValue(ok);
    const cached = createReadinessCache(run, 100, () => clock);
    await cached();
    clock = 50;
    const second = await cached();
    expect(second.cached).toBe(true);
    clock = 200;
    const third = await cached();
    expect(third.cached).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
