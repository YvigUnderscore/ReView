// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { ITEST_DATABASE_SUFFIX } from './itestEnv';

/**
 * Isolation properties of the integration suite, verified by the suite itself.
 *
 * They are not visible in the other files: those would pass just as well on the development
 * database, or by receiving 429s instead of their assertions. This file exists so that a
 * regression in the plumbing shows up as a failure, and a failure here.
 */
const app = createApp({ rateLimit: false });

describe('Integration — database isolation', () => {
  it('the suite writes to a disposable database, never to the development one', async () => {
    const rows = await prisma.$queryRawUnsafe<{ current_database: string }[]>('SELECT current_database()');
    expect(rows[0]?.current_database.endsWith(ITEST_DATABASE_SUFFIX)).toBe(true);
  });

  it('the database was reset: no trace of previous runs', async () => {
    // `globalSetup` replays the migrations on an empty database. The only accounts present are
    // therefore those the suite has just created: there were none at startup.
    const leftovers = await prisma.user.count({ where: { email: { startsWith: 'it-artist-' } } });
    expect(leftovers).toBeLessThanOrEqual(1);
  });
});

describe('Integration — disabled rate limiters (createApp({ rateLimit: false }))', () => {
  it('a rate limiter mounted by createApp no longer counts (/api/setup, ceiling 10 / 15 min)', async () => {
    const codes = new Set<number>();
    for (let i = 0; i < 15; i += 1) {
      codes.add((await request(app).get('/api/setup/status')).status);
    }
    expect([...codes]).not.toContain(429);
  });

  it("a rate limiter built at router import time no longer counts (/api/unsubscribe, ceiling 60 / 15 min)", async () => {
    const codes = new Set<number>();
    for (let i = 0; i < 70; i += 1) {
      codes.add((await request(app).get('/api/unsubscribe/not-a-valid-token')).status);
    }
    expect([...codes]).not.toContain(429);
  });

  it("the option is refused outside NODE_ENV=test: no instance can end up without a rate limiter", () => {
    const mutable = env as { NODE_ENV: string };
    const saved = mutable.NODE_ENV;
    mutable.NODE_ENV = 'production';
    try {
      expect(() => createApp({ rateLimit: false })).toThrow(/NODE_ENV=test/);
    } finally {
      mutable.NODE_ENV = saved;
    }
  });
});
