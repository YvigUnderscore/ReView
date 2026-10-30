// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

// The assembled app, without Redis: the transport is armed by `createApp`, so it is the one piece
// replaced. Every request below is answered before any database or queue is reached.
vi.mock('./lib/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/redis')>()),
  enableRedisTransport: vi.fn(),
}));

import request from 'supertest';
import { createApp } from './app';

const app = createApp({ rateLimit: false });

describe('createApp', () => {
  it('serves the public OpenAPI document, with the security headers', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('mounts the refresh-cookie router before /api/auth: CSRF header first, then the cookie', async () => {
    const noHeader = await request(app).post('/api/auth/refresh');
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.code).toBe('CSRF_HEADER_REQUIRED');

    const noCookie = await request(app).post('/api/auth/refresh').set('X-Requested-With', 'ReView');
    expect(noCookie.status).toBe(401);
    expect(noCookie.body.code).toBe('NO_REFRESH_TOKEN');
  });

  it('protects the API behind authentication', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_REQUIRED');
  });

  it('refuses the test-only switch outside NODE_ENV=test', async () => {
    const { env } = await import('./config/env');
    const previous = env.NODE_ENV;
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    try {
      expect(() => createApp({ rateLimit: false })).toThrow(/reserved for NODE_ENV=test/);
    } finally {
      (env as { NODE_ENV: string }).NODE_ENV = previous;
    }
  });
});
