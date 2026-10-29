// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `auditLog`: since A5-03, each login attempt writes its trace. The double must return a promise:
// `logAudit` detaches the write and attaches a `.catch` to it.
const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() }, auditLog: { create: vi.fn().mockResolvedValue({}) } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/sessions', () => ({
  createSession: vi.fn().mockResolvedValue('sid-1'),
  isSessionActive: vi.fn().mockResolvedValue(true),
  touchSession: vi.fn(),
}));
vi.mock('../lib/oidcConfig', () => ({ isPasswordLoginBlocked: vi.fn().mockResolvedValue(false) }));
vi.mock('../lib/userView', () => ({ toSessionUser: vi.fn(async (u: { id: number }) => ({ id: u.id })) }));
vi.mock('../middleware/auth', async () => ({
  ...(await import('../middleware/authUser')),
  authenticate: vi.fn(),
}));

import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import authRoutes from './auth.routes';
import { errorHandler } from '../middleware/error';

const app = express().use(express.json()).use('/api/auth', authRoutes).use(errorHandler);

// Cost 4: these tests measure the counting, not the resistance of the hash.
const HASH = bcrypt.hashSync('Motdepasse1', 4);

const login = (email: string, password = 'MauvaisMdp1') =>
  request(app).post('/api/auth/login').send({ email, password });

beforeEach(() => {
  db.user.findUnique.mockResolvedValue({
    id: 7,
    email: 'alice@studio.com',
    password: HASH,
    role: 'ARTIST',
    isService: false,
    totpEnabledAt: null,
    disabledAt: null,
  });
});

/**
 * A5-02: a single limiter of 50 hits / 15 min indexed on the IP bounded nothing.
 *
 * Two effects, both reachable. On the security side: an attacker spreading their attempts over a
 * hundred source addresses gets five thousand attempts per quarter hour on a single account, without
 * ever triggering a lock. On the availability side: a studio of fifty people goes out through a single
 * public IP, and the fifty-first arrival in the morning gets a 429 although no password is wrong.
 *
 * The counter of the per-account brake is per process under `NODE_ENV=test` (cf. rateLimit.ts) and
 * lives in the route's module: it fills up from one test to the next in this file, which is exactly
 * what we want to measure here.
 */
describe('POST /api/auth/login — per-account brake (A5-02)', () => {
  it('bounds the attempts targeting a given address, then refuses with 429', async () => {
    // The per-account cap is ten: the first ten attempts are ordinary refusals.
    for (let i = 0; i < 10; i += 1) {
      expect((await login('alice@studio.com')).status).toBe(401);
    }
    const blocked = await login('alice@studio.com');
    expect(blocked.status).toBe(429);
  });

  // The key is the TARGETED address, not the source: another account attacked from the same machine
  // keeps its own budget, and conversely, changing machine reopens nothing.
  it('does not penalize another account from the same source', async () => {
    const other = await login('bob@studio.com');
    expect(other.status).toBe(401);
  });

  // The address is normalized before serving as a key: without this, alternating the case would give
  // a fresh counter on every attempt, that is, no brake at all.
  it('cannot be bypassed by changing the case of the address', async () => {
    const blocked = await login('ALICE@Studio.com');
    expect(blocked.status).toBe(429);
  });
});
