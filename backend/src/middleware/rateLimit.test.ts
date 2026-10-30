// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { rateLimit, identityRateKey, identityMax, __rateLimitTesting } from './rateLimit';
import { signAccessToken, signRefreshToken, signTwoFaToken } from '../lib/jwt';
import { Role } from '@prisma/client';

/**
 * The counting itself lives in Redis (Lua script of `rate-limit-redis`): these tests substitute the
 * counter to verify what is ours: the choice of the key, the ceiling, isolation between limiters, and
 * **fail-closed** behavior when the counter is silent.
 */

/** In-memory counter, a single window: enough to exercise the middleware's logic. */
function memoryCounters() {
  const hits = new Map<string, number>();
  const opened: { name: string; windowMs: number }[] = [];
  let broken = false;
  return {
    hits,
    opened,
    break: (): void => {
      broken = true;
    },
    factory: (name: string, windowMs: number) => {
      opened.push({ name, windowMs });
      return {
        hit: (key: string): Promise<number> => {
          if (broken) return Promise.reject(new Error('redis down'));
          const full = `${name}:${key}`;
          const total = (hits.get(full) ?? 0) + 1;
          hits.set(full, total);
          return Promise.resolve(total);
        },
      };
    },
  };
}

let counters: ReturnType<typeof memoryCounters>;

beforeEach(() => {
  counters = memoryCounters();
  __rateLimitTesting.setCounterFactory(counters.factory);
});

afterEach(() => {
  __rateLimitTesting.setCounterFactory(null);
});

/** Plays a request through the middleware and returns what it did with it. */
async function call(
  mw: ReturnType<typeof rateLimit>,
  req: Partial<Request>,
): Promise<{ passed: boolean; statusCode: number }> {
  let statusCode = 0;
  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => (settle = resolve));
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      settle();
      return this;
    },
  };
  const next = vi.fn(() => settle()) as unknown as NextFunction;
  mw({ headers: {}, ...req } as Request, res as unknown as Response, next);
  await done;
  return { passed: (next as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0, statusCode };
}

describe('rateLimit — ceiling', () => {
  it('lets requests through up to the limit, then responds 429', async () => {
    const mw = rateLimit({ name: 't1', max: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) expect((await call(mw, { ip: '1.2.3.4' })).passed).toBe(true);
    const blocked = await call(mw, { ip: '1.2.3.4' });
    expect(blocked.passed).toBe(false);
    expect(blocked.statusCode).toBe(429);
  });

  it('counts two clients separately', async () => {
    const mw = rateLimit({ name: 't2', max: 1, windowMs: 60_000 });
    expect((await call(mw, { ip: '1.1.1.1' })).passed).toBe(true);
    expect((await call(mw, { ip: '2.2.2.2' })).passed).toBe(true);
    expect((await call(mw, { ip: '1.1.1.1' })).passed).toBe(false);
  });

  it('accepts a ceiling computed per request', async () => {
    const mw = rateLimit({
      name: 't3',
      windowMs: 60_000,
      max: (req) => (req.ip === 'vip' ? 3 : 1),
      keyGenerator: (req) => req.ip ?? 'x',
    });
    expect((await call(mw, { ip: 'vip' })).passed).toBe(true);
    expect((await call(mw, { ip: 'vip' })).passed).toBe(true);
    expect((await call(mw, { ip: 'autre' })).passed).toBe(true);
    expect((await call(mw, { ip: 'autre' })).passed).toBe(false);
  });

  // Some limiters (unlocking a share) run BEFORE Zod validation: the key then incorporates an arbitrary
  // request value of free length.
  it('caps the length of the key', async () => {
    const mw = rateLimit({
      name: 't4',
      max: 1,
      windowMs: 60_000,
      keyGenerator: (r) => String(r.params?.token),
    });
    const long = 'a'.repeat(50_000);
    expect((await call(mw, { params: { token: long } } as Partial<Request>)).passed).toBe(true);
    // Same prefix, same counter: the key was indeed truncated, not left whole.
    expect((await call(mw, { params: { token: long + 'DIFFERENT' } } as Partial<Request>)).passed).toBe(
      false,
    );
  });

  // A client's counter must never be affected by another's activity: this limiter's key incorporates a
  // request datum, so the same client can forge as many as it likes. Each key is independent in Redis
  // and expires at the end of ITS window.
  it('does not give attempts back to a client forging thousands of keys', async () => {
    const mw = rateLimit({
      name: 't5',
      max: 1,
      windowMs: 60_000,
      keyGenerator: (r) => String(r.params?.token),
    });
    const victim = { params: { token: 'cible' } } as Partial<Request>;
    expect((await call(mw, victim)).passed).toBe(true);
    expect((await call(mw, victim)).passed).toBe(false);
    for (let i = 0; i < 2_000; i++) await call(mw, { params: { token: `t${i}` } } as Partial<Request>);
    expect((await call(mw, victim)).passed).toBe(false);
  });
});

describe('rateLimit — isolation and failure', () => {
  it('two distinct limiters do not share their counter', async () => {
    const global = rateLimit({ name: 'global', max: 2, windowMs: 60_000 });
    const share = rateLimit({ name: 'share', max: 1, windowMs: 60_000 });
    expect((await call(share, { ip: '9.9.9.9' })).passed).toBe(true);
    expect((await call(share, { ip: '9.9.9.9' })).passed).toBe(false);
    // The global limiter consumed nothing for this IP.
    expect((await call(global, { ip: '9.9.9.9' })).passed).toBe(true);
  });

  it('without an explicit name, the fingerprint separates limiters with different options', () => {
    const a = __rateLimitTesting.fingerprint({ windowMs: 900_000, max: 10 });
    const b = __rateLimitTesting.fingerprint({ windowMs: 900_000, max: 5000 });
    const c = __rateLimitTesting.fingerprint({ windowMs: 900_000, max: 10 });
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });

  it('fail closed: silent counter ⇒ 429, never a silent pass', async () => {
    const mw = rateLimit({ name: 't6', max: 100, windowMs: 60_000 });
    expect((await call(mw, { ip: '1.2.3.4' })).passed).toBe(true);
    counters.break();
    const blocked = await call(mw, { ip: '1.2.3.4' });
    expect(blocked.passed).toBe(false);
    expect(blocked.statusCode).toBe(429);
  });

  // Under NODE_ENV=test the storage is a process counter: the suite must neither require a live Redis
  // nor inherit the counters of the previous run.
  it('the default counter counts, then reopens its window at expiry', async () => {
    __rateLimitTesting.setCounterFactory(null);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const mw = rateLimit({ name: 'defaut', max: 1, windowMs: 1_000 });
      expect((await call(mw, { ip: '3.3.3.3' })).passed).toBe(true);
      expect((await call(mw, { ip: '3.3.3.3' })).passed).toBe(false);
      vi.setSystemTime(new Date(Date.now() + 1_001));
      expect((await call(mw, { ip: '3.3.3.3' })).passed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens one counter per limiter, with its name and window', async () => {
    await call(rateLimit({ name: 'alpha', windowMs: 1_000 }), { ip: 'a' });
    await call(rateLimit({ name: 'beta', windowMs: 2_000 }), { ip: 'a' });
    expect(counters.opened).toEqual([
      { name: 'alpha', windowMs: 1_000 },
      { name: 'beta', windowMs: 2_000 },
    ]);
  });
});

describe('identityRateKey', () => {
  const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` }, ip: '5.5.5.5' });

  it('indexes on the account when the access token is valid', () => {
    const token = signAccessToken({ id: 42, email: 'a@b.c', role: Role.ARTIST, sid: 'sid-test' });
    expect(identityRateKey(bearer(token) as unknown as Request)).toBe('u:42');
  });

  it('falls back to the IP without a token, or with an unreadable token', () => {
    expect(identityRateKey({ headers: {}, ip: '5.5.5.5' } as unknown as Request)).toBe('ip:5.5.5.5');
    expect(identityRateKey(bearer('nimportequoi') as unknown as Request)).toBe('ip:5.5.5.5');
  });

  // A refresh or 2FA token does not authenticate a request: giving it its own counter would offer a
  // second quota reserve to whoever already owns an account.
  it('accepts only the access token, not the other types signed with the same secret', () => {
    const refresh = signRefreshToken({ id: 7, email: 'a@b.c', role: Role.ARTIST, sid: 'sid-test' });
    const twofa = signTwoFaToken(7);
    expect(identityRateKey(bearer(refresh) as unknown as Request)).toBe('ip:5.5.5.5');
    expect(identityRateKey(bearer(twofa) as unknown as Request)).toBe('ip:5.5.5.5');
  });

  it('memoizes the key on the request: a single signature check', () => {
    const token = signAccessToken({ id: 8, email: 'a@b.c', role: Role.ARTIST, sid: 'sid-test' });
    const req = bearer(token) as unknown as Request;
    expect(identityRateKey(req)).toBe('u:8');
    // The signature is erased: without memoization the key would fall back to the IP.
    (req.headers as Record<string, string>)['authorization'] = 'Bearer casse';
    expect(identityRateKey(req)).toBe('u:8');
  });

  it('identityMax distinguishes the account ceiling from the NAT exit ceiling', () => {
    const max = identityMax(6_000, 5_000);
    const token = signAccessToken({ id: 3, email: 'a@b.c', role: Role.ARTIST, sid: 'sid-test' });
    expect(max(bearer(token) as unknown as Request)).toBe(6_000);
    expect(max({ headers: {}, ip: '5.5.5.5' } as unknown as Request)).toBe(5_000);
  });

  it('two accounts behind the same IP no longer share a counter', async () => {
    const mw = rateLimit({ name: 'nat', max: 1, windowMs: 60_000, keyGenerator: identityRateKey });
    const un = signAccessToken({ id: 1, email: 'a@b.c', role: Role.ARTIST, sid: 'sid-test' });
    const deux = signAccessToken({ id: 2, email: 'd@b.c', role: Role.ARTIST, sid: 'sid-test' });
    expect((await call(mw, bearer(un))).passed).toBe(true);
    expect((await call(mw, bearer(deux))).passed).toBe(true);
    expect((await call(mw, bearer(un))).passed).toBe(false);
  });
});
