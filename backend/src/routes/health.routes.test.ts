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
 * Liveness must never depend on a dependency: restarting the API container because Postgres went down
 * adds one outage to another.
 */
describe('GET /health — liveness', () => {
  it('responds without touching the database, Redis or storage', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(redisCall).not.toHaveBeenCalled();
    expect(storagePing).not.toHaveBeenCalled();
  });

  it('announces the instance version', async () => {
    const res = await request(app).get('/health');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version).not.toBe('');
    expect(typeof res.body.uptimeSec).toBe('number');
  });

  it('exposes the same content on /health/live', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /health/ready — availability', () => {
  it('queries the three dependencies, responds 200, then serves the memoized result', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database.ok).toBe(true);
    expect(res.body.checks.redis.ok).toBe(true);
    expect(res.body.checks.storage.ok).toBe(true);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redisCall).toHaveBeenCalledWith('PING');
    expect(storagePing).toHaveBeenCalledTimes(1);

    // Next probe within the memoization window: no dependency is touched again.
    const again = await request(app).get('/health/ready');
    expect(again.body.cached).toBe(true);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('responds 503 as soon as a dependency is missing (a front end must be able to read it)', async () => {
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
   * The graceful shutdown lets in-flight requests finish for a few seconds. As long as the probe
   * answered 200 during that delay, the front end kept routing new traffic to it, arriving after the
   * closing. `isShuttingDown` existed to say so and had no caller: the draining was done, but never
   * announced.
   */
  it('responds 503 during shutdown, even with healthy dependencies', async () => {
    vi.mocked(isShuttingDown).mockReturnValue(true);
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('shutting-down');
  });

  /**
   * The state is local and certain: nothing justifies waiting for a database that is about to close.
   * A fresh router, otherwise the result memoized by the previous tests would suffice to avoid the
   * call and the assertion would pass for the wrong reason.
   */
  it('queries no dependency during shutdown', async () => {
    vi.mocked(isShuttingDown).mockReturnValue(true);
    const sonde = vi.fn().mockResolvedValue(1);
    const neuf = express().use('/health', buildHealthRouter({ database: sonde }));
    const res = await request(neuf).get('/health/ready');
    expect(res.status).toBe(503);
    expect(sonde).not.toHaveBeenCalled();
  });

  // Liveness, for its part, does not move: the process still answers, that is all it says.
  it('lets liveness answer 200 during shutdown', async () => {
    vi.mocked(isShuttingDown).mockReturnValue(true);
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/version', () => {
  it('publishes version, runtime and source URLs (AGPL §13)', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('https://git.studio.tld/review');
    expect(res.body.node).toBe(process.version);
    expect(res.body).toHaveProperty('commit');
    expect(res.body).toHaveProperty('builtAt');
  });
});
