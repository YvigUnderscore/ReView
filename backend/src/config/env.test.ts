// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { envSchema } from './env';

// Valid production baseline (strong secrets, strict CORS, real S3 credentials).
const prodBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/review',
  JWT_SECRET: 'x'.repeat(40),
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY: 'AKIAREALKEY',
  S3_SECRET_KEY: 'realsecretvalue',
  CORS_ORIGIN: 'https://review.example.com',
};

const issuePaths = (input: Record<string, unknown>) => {
  const r = envSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe('env — production hardening (10.D5)', () => {
  it('accepts a correct production configuration', () => {
    expect(envSchema.safeParse(prodBase).success).toBe(true);
  });

  it('refuses a default or weak JWT_SECRET in production', () => {
    expect(issuePaths({ ...prodBase, JWT_SECRET: 'change_me_with_a_long_random_secret_min_32c' })).toContain(
      'JWT_SECRET',
    );
    expect(issuePaths({ ...prodBase, JWT_SECRET: 'court' })).toContain('JWT_SECRET');
  });

  it("refuses CORS_ORIGIN='*' in production", () => {
    expect(issuePaths({ ...prodBase, CORS_ORIGIN: '*' })).toContain('CORS_ORIGIN');
  });

  it('refuses the default MinIO credentials in production', () => {
    expect(issuePaths({ ...prodBase, S3_ACCESS_KEY: 'minioadmin', S3_SECRET_KEY: 'minioadmin' })).toContain(
      'S3_SECRET_KEY',
    );
  });

  it('in development, weak secrets are tolerated (guards inactive)', () => {
    // >= 16 (base minimum) but weak (contains change_me): accepted outside production.
    const dev = { ...prodBase, NODE_ENV: 'development', JWT_SECRET: 'change_me_devkey', CORS_ORIGIN: '*' };
    expect(envSchema.safeParse(dev).success).toBe(true);
  });
});

/**
 * TRUST_PROXY: the value passed to `app.set('trust proxy', ...)` (backend/src/app.ts).
 *
 * It decides whether `req.ip` (the key of ALL rate limiters and the address written to the
 * audit log) is read from the socket or from `X-Forwarded-For`, a header the caller supplies.
 * Hard-coded to 1, it made every rate limiter bypassable with a header as soon as the backend
 * was reachable without a proxy in front: a fresh quota per made-up address.
 *
 * The last two cases start a real Express server: the observable behaviour is locked down,
 * not the value of the variable.
 */
const ipApp = (trustProxy: number) => {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
};

const observedIp = async (trustProxy: number, forwardedFor: string): Promise<string> => {
  const res = await request(ipApp(trustProxy)).get('/ip').set('X-Forwarded-For', forwardedFor);
  return (res.body as { ip: string }).ip;
};

describe('env — TRUST_PROXY (A3-01 / A5-01)', () => {
  it('trusts no proxy until it is explicitly requested', () => {
    expect(envSchema.parse(prodBase).TRUST_PROXY).toBe(0);
    // An empty variable (compose passes `${TRUST_PROXY:-}` when .env is silent) falls back to
    // the cautious behaviour, never to "trust everything".
    expect(envSchema.parse({ ...prodBase, TRUST_PROXY: '' }).TRUST_PROXY).toBe(0);
  });

  it('accepts a bounded number of hops, and nothing else', () => {
    expect(envSchema.parse({ ...prodBase, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(issuePaths({ ...prodBase, TRUST_PROXY: 'true' })).toContain('TRUST_PROXY');
    expect(issuePaths({ ...prodBase, TRUST_PROXY: '-1' })).toContain('TRUST_PROXY');
    expect(issuePaths({ ...prodBase, TRUST_PROXY: '9' })).toContain('TRUST_PROXY');
    expect(issuePaths({ ...prodBase, TRUST_PROXY: '1.5' })).toContain('TRUST_PROXY');
  });

  it('by default, a forged X-Forwarded-For no longer decides the client address', async () => {
    const ip = await observedIp(envSchema.parse(prodBase).TRUST_PROXY, '203.0.113.7');
    expect(ip).not.toBe('203.0.113.7');
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('at 1 — a single proxy in front — req.ip is the last entry, the one the proxy added', async () => {
    // What nginx's `$proxy_add_x_forwarded_for` produces: the client's value first, the real
    // address appended after it. Only the last one is trustworthy.
    const ip = await observedIp(
      envSchema.parse({ ...prodBase, TRUST_PROXY: '1' }).TRUST_PROXY,
      '203.0.113.7, 10.0.0.9',
    );
    expect(ip).toBe('10.0.0.9');
  });
});
