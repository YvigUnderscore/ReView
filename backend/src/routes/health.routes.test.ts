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
vi.mock('../lib/gracefulShutdown', () => ({ isShuttingDown: vi.fn(() => false) }));
vi.mock('../lib/settings', () => ({
  getSourceUrl: vi.fn().mockResolvedValue('https://git.studio.tld/review'),
}));

import express from 'express';
import request from 'supertest';
import { isShuttingDown } from '../lib/gracefulShutdown';
import healthRoutes, { buildHealthRouter, versionRouter } from './health.routes';

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

  /**
   * L'arrêt propre laisse finir les requêtes en cours pendant quelques secondes. Tant que
   * la sonde répondait 200 pendant ce délai, le frontal continuait d'y router du trafic
   * neuf — arrivé après la fermeture. `isShuttingDown` existait pour le dire et n'avait
   * aucun appelant : le drainage était fait, mais jamais annoncé.
   */
  it('répond 503 pendant l’arrêt, même dépendances saines', async () => {
    vi.mocked(isShuttingDown).mockReturnValue(true);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('shutting-down');
  });

  /**
   * L'état est local et certain : rien ne justifie d'attendre une base qui va fermer.
   * Routeur neuf, sinon le résultat mémorisé par les tests précédents suffirait à éviter
   * l'appel et l'assertion passerait pour la mauvaise raison.
   */
  it('n’interroge aucune dépendance pendant l’arrêt', async () => {
    vi.mocked(isShuttingDown).mockReturnValue(true);
    const sonde = vi.fn().mockResolvedValue(1);
    const neuf = express().use('/health', buildHealthRouter({ database: sonde }));
    const res = await request(neuf).get('/health/ready');
    expect(res.status).toBe(503);
    expect(sonde).not.toHaveBeenCalled();
  });

  // La vivacité, elle, ne bouge pas : le process répond encore, c'est tout ce qu'elle dit.
  it('laisse la vivacité répondre 200 pendant l’arrêt', async () => {
    vi.mocked(isShuttingDown).mockReturnValue(true);
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
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
