// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/crypto', () => ({
  encryptSecret: (s: string) => s,
  decryptSecret: (s: string) => s,
}));
vi.mock('../lib/sessions', () => ({ createSession: vi.fn().mockResolvedValue('sid-1') }));
vi.mock('../lib/userView', () => ({ toSessionUser: vi.fn(async (u: { id: number }) => ({ id: u.id })) }));
vi.mock('../services/AuditService', () => ({ logAudit: vi.fn() }));

import express from 'express';
import request from 'supertest';
import auth2faRoutes from './auth-2fa.routes';
import { errorHandler } from '../middleware/error';
import { signTwoFaToken } from '../lib/jwt';
import { generateTotpSecret, currentTotp, generateBackupCodes, __testing } from '../lib/twofa';
import { createFakeRedis } from '../lib/redisFake';
import { __redisTesting } from '../lib/redis';

const app = express().use(express.json()).use('/api/auth/2fa', auth2faRoutes).use(errorHandler);

/** TOTP replay protection is now shared: the route talks to Redis. */
const redis = createFakeRedis();

const secret = generateTotpSecret();
const backup = generateBackupCodes();
const tmpToken = signTwoFaToken(7);

/**
 * ⚠ The per-account brake of `/verify` (A5-02) caps at ten attempts per quarter hour, and its test
 * counter is per process: all calls in this file carrying the SAME `tmpToken` share that budget. An
 * additional scenario takes its own token (`signTwoFaToken` on another identifier) rather than
 * exhausting this one.
 */
const verify = (code: string, token = tmpToken) =>
  request(app).post('/api/auth/2fa/verify').send({ tmpToken: token, code });

beforeEach(() => {
  vi.clearAllMocks();
  __testing.usedTotp.clear();
  redis.flush();
  redis.failing = false;
  __redisTesting.setClient(redis);
  db.user.findUnique.mockResolvedValue({
    id: 7,
    email: 'a@b.c',
    role: 'ARTIST',
    totpSecret: secret,
    totpEnabledAt: new Date(),
    backupCodes: [...backup.hashes],
  });
  db.user.updateMany.mockResolvedValue({ count: 1 });
});

afterAll(() => {
  __redisTesting.reset();
});

/**
 * A TOTP code stays valid for its whole time step. Without a memory of the codes already presented,
 * the one that is intercepted can be replayed for as long as the window lasts: the second factor then
 * no longer proves possession of the phone.
 */
describe('POST /api/auth/2fa/verify — TOTP code replay protection', () => {
  it('accepts the code the first time', async () => {
    const res = await verify(await currentTotp(secret));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).not.toHaveProperty('refreshToken'); // httpOnly cookie instead
    expect(String(res.headers['set-cookie'])).toMatch(/review_refresh=.*HttpOnly/i);
  });

  it('rejects the same code replayed, like a wrong code', async () => {
    const code = await currentTotp(secret);
    expect((await verify(code)).status).toBe(200);
    const replay = await verify(code);
    expect(replay.status).toBe(401);
    expect((replay.body as { code: string }).code).toBe('TWOFA_BAD_CODE');
  });

  it('rejects a wrong code', async () => {
    expect((await verify('000000')).status).toBe(401);
  });
});

/**
 * A3-09: the route consumed the code in a process `Map`. Two replicas behind the same front end
 * therefore shared nothing: the intercepted code went through again by landing on the second one, and
 * a simple restart was enough to make it replayable. These two scenarios fail as long as the route
 * calls the local guard instead of the shared one.
 */
describe('POST /api/auth/2fa/verify — replay protection shared across replicas (A3-09)', () => {
  it('rejects a code already consumed on ANOTHER replica', async () => {
    const token = signTwoFaToken(101);
    const code = await currentTotp(secret);
    expect((await verify(code, token)).status).toBe(200);
    // What the second replica sees: its process memory is blank; only the shared marker attests to
    // the first attempt.
    __testing.usedTotp.clear();
    const replay = await verify(code, token);
    expect(replay.status).toBe(401);
    expect((replay.body as { code: string }).code).toBe('TWOFA_BAD_CODE');
  });

  it('rejects the code when the shared marker is unreachable (fail closed)', async () => {
    // The refusal is the intended behavior: without a marker, the route cannot assert that the code has
    // not already been used elsewhere. It loses nothing in availability, since the two limiters that
    // precede it are also backed by Redis.
    redis.failing = true;
    expect((await verify(await currentTotp(secret), signTwoFaToken(102))).status).toBe(401);
  });
});

describe('POST /api/auth/2fa/verify — backup codes', () => {
  it('accepts a backup code and removes it from the list', async () => {
    const res = await verify(backup.plain[2]!);
    expect(res.status).toBe(200);
    const call = db.user.updateMany.mock.calls[0]![0] as {
      where: { backupCodes: { has: string } };
      data: { backupCodes: string[] };
    };
    expect(call.data.backupCodes).toHaveLength(9);
    expect(call.data.backupCodes).not.toContain(backup.hashes[2]);
    // The deletion is conditional on the code still being present: that is what serializes two
    // concurrent requests carrying the same code on the PostgreSQL row.
    expect(call.where.backupCodes.has).toBe(backup.hashes[2]);
  });

  it('accepts a backup code transcribed with free case and separators', async () => {
    const res = await verify(backup.plain[4]!.replace(/-/g, '').toUpperCase());
    expect(res.status).toBe(200);
  });

  // The race: two requests carry the same code, and PostgreSQL only lets one consume it.
  it('refuses when the row no longer carries the code', async () => {
    db.user.updateMany.mockResolvedValue({ count: 0 });
    const res = await verify(backup.plain[5]!);
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe('TWOFA_BAD_CODE');
  });

  it('rejects an unknown backup code without touching the list', async () => {
    const res = await verify('deadbeefdeadbeefdeadbeefdeadbeef');
    expect(res.status).toBe(401);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });

  // 128 bits in hexadecimal grouped by 8: 35 characters. The validation ceiling must let them through,
  // otherwise the backup code is refused on the day the phone is lost.
  it('lets through the length of a 128-bit backup code', async () => {
    expect(backup.plain[0]).toHaveLength(35);
    const res = await verify(backup.plain[0]!);
    expect(res.status).toBe(200);
  });
});

/**
 * A1-01: fourth gate, the account may be deactivated between the password and the code. The second
 * factor is not one more entry point, it is the same entry point: without this guard, 2FA would hand
 * the leaver the token that `/login` had just refused them.
 */
describe('POST /api/auth/2fa/verify — deactivated account', () => {
  it('rejects a deactivated account, even with a valid TOTP code', async () => {
    db.user.findUnique.mockResolvedValue({
      id: 7,
      email: 'a@b.c',
      role: 'ARTIST',
      totpSecret: secret,
      totpEnabledAt: new Date(),
      backupCodes: [...backup.hashes],
      disabledAt: new Date(),
    });
    const res = await verify(await currentTotp(secret), signTwoFaToken(8));
    expect(res.status).toBe(401);
    expect((res.body as { code: string }).code).toBe('ACCOUNT_DISABLED');
  });
});

/**
 * A5-02: the `/verify` limiter was fifteen hits per IP, with no link to the account targeted by the
 * `tmpToken`. Two defects at once: the sixteenth arrival in the morning, behind the studio's NAT exit,
 * could no longer validate their code; and attempts coming from several machines were bounded on no account.
 */
describe('POST /api/auth/2fa/verify — per-account brake (A5-02)', () => {
  it('bounds the attempts targeting a given account, then refuses with 429', async () => {
    const token = signTwoFaToken(99);
    for (let i = 0; i < 10; i += 1) {
      expect((await verify('000000', token)).status).toBe(401);
    }
    expect((await verify('000000', token)).status).toBe(429);
    // Another account keeps its budget: the key is the account, not the source.
    expect((await verify('000000', signTwoFaToken(100))).status).toBe(401);
  });
});
