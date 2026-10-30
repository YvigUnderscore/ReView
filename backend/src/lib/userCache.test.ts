// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() } } }));
vi.mock('./prisma', () => ({ prisma: db }));

import { getAuthUser, invalidateAuthUser, __testing } from './userCache';
import { __redisTesting, enableRedisTransport } from './redis';
import { createFakeRedis, type FakeRedis } from './redisFake';
import { Role } from '@prisma/client';

const user = { id: 1, email: 'a@b.c', role: Role.ARTIST, disabledAt: null };
let redis: FakeRedis;

beforeEach(() => {
  vi.clearAllMocks();
  __testing.cache.clear();
  __testing.reset();
  __redisTesting.reset();
  redis = createFakeRedis();
  __redisTesting.setClient(redis);
  enableRedisTransport();
  db.user.findUnique.mockResolvedValue(user);
});

describe('getAuthUser', () => {
  it('reads the database only once for closely spaced calls', async () => {
    // That is the whole point: one navigation triggers twenty to forty API calls.
    await getAuthUser(1);
    await getAuthUser(1);
    await getAuthUser(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  // A1-01: a right that is not loaded is a right that cannot be refused. Without this column,
  // `middleware/auth` had nothing to test for an account that had left the studio.
  it('loads the deactivation date with the identity', async () => {
    await getAuthUser(1);
    const call = db.user.findUnique.mock.calls[0]![0] as { select: Record<string, boolean> };
    expect(call.select).toMatchObject({ disabledAt: true });
  });

  it('returns the same identity from the cache', async () => {
    expect(await getAuthUser(1)).toEqual(user);
    db.user.findUnique.mockResolvedValue({ ...user, role: Role.ADMIN });
    expect(await getAuthUser(1)).toEqual(user);
  });

  it('re-reads the database once the delay has elapsed', async () => {
    await getAuthUser(1);
    __testing.cache.set(1, { user, until: Date.now() - 1 });
    await getAuthUser(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('also caches the absence of an account', async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect(await getAuthUser(42)).toBeNull();
    expect(await getAuthUser(42)).toBeNull();
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('keeps accounts separate', async () => {
    db.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce({ ...user, id: 2 });
    expect((await getAuthUser(1))?.id).toBe(1);
    expect((await getAuthUser(2))?.id).toBe(2);
  });
});

describe('invalidateAuthUser', () => {
  it('forces a re-read: a demoted role applies immediately', async () => {
    await getAuthUser(1);
    invalidateAuthUser(1);
    db.user.findUnique.mockResolvedValue({ ...user, role: Role.CLIENT });
    expect((await getAuthUser(1))?.role).toBe(Role.CLIENT);
    expect(db.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('does not touch other accounts', async () => {
    await getAuthUser(1);
    invalidateAuthUser(999);
    await getAuthUser(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });

  // Without notification, demoting an account would have emptied the cache only in the replica
  // that handled the write: the others would have served the old role for up to thirty seconds.
  it('notifies the other replicas', async () => {
    await getAuthUser(1);
    invalidateAuthUser(1);
    expect(redis.published).toEqual([{ channel: __testing.INVALIDATE_CHANNEL, payload: '1' }]);
  });

  it('forgets the entry on notification from another replica', async () => {
    await getAuthUser(1);
    __redisTesting.deliver(__testing.INVALIDATE_CHANNEL, '1');
    db.user.findUnique.mockResolvedValue({ ...user, role: Role.CLIENT });
    expect((await getAuthUser(1))?.role).toBe(Role.CLIENT);
  });

  it('ignores an unreadable notification rather than emptying the whole cache', async () => {
    await getAuthUser(1);
    __redisTesting.deliver(__testing.INVALIDATE_CHANNEL, 'pas-un-id');
    await getAuthUser(1);
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('cache bounds', () => {
  it('empties itself instead of growing without limit', async () => {
    for (let i = 0; i < 5_001; i += 1) __testing.cacheSet(i, user);
    expect(__testing.cache.size).toBeLessThanOrEqual(5_000);
  });
});
