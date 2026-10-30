// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { update } = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue({}) }));
vi.mock('../lib/prisma', () => ({ prisma: { user: { update } } }));

import { __redisTesting, enableRedisTransport } from '../lib/redis';
import { createFakeRedis, type FakeRedis } from '../lib/redisFake';
import {
  __resetPresence,
  getOnlineUserIds,
  getReviewViewers,
  joinReview,
  leaveReview,
  markOffline,
  markOnline,
  setPresenceBroadcaster,
  startPresenceSync,
  PRESENCE_TTL_MS,
  type ReviewViewer,
} from './PresenceService';

const viewer = (id: number, name = `User ${id}`): ReviewViewer => ({
  id,
  displayName: name,
  initials: name.slice(0, 2).toUpperCase(),
  avatarUrl: null,
});

let redis: FakeRedis;
let broadcasts: number[][];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-22T10:00:00Z'));
  update.mockClear();
  __redisTesting.reset();
  __resetPresence();
  redis = createFakeRedis();
  __redisTesting.setClient(redis);
  enableRedisTransport();
  broadcasts = [];
  setPresenceBroadcaster((ids) => broadcasts.push(ids));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advances the clock without triggering a timer (only `Date` is simulated). */
const advance = (ms: number): void => {
  vi.setSystemTime(new Date(Date.now() + ms));
};

describe('online presence', () => {
  it('counts the tabs: online at the first, offline at the last', async () => {
    await markOnline(1, 'ongletA');
    expect(getOnlineUserIds()).toEqual([1]);
    await markOnline(1, 'ongletB');
    expect(getOnlineUserIds()).toEqual([1]);
    await markOffline(1, 'ongletA');
    expect(getOnlineUserIds()).toEqual([1]);
    await markOffline(1, 'ongletB');
    expect(getOnlineUserIds()).toEqual([]);
  });

  it('only broadcasts on an effective change of the list', async () => {
    await markOnline(1, 'a');
    await markOnline(1, 'b');
    await markOnline(2, 'c');
    expect(broadcasts).toEqual([[1], [1, 2]]);
  });

  it('writes lastSeenAt at the first connection and at the last disconnection, not in between', async () => {
    await markOnline(1, 'a');
    expect(update).toHaveBeenCalledOnce();
    await markOnline(1, 'b');
    expect(update).toHaveBeenCalledOnce();
    await markOffline(1, 'a');
    expect(update).toHaveBeenCalledOnce();
    await markOffline(1, 'b');
    expect(update).toHaveBeenCalledTimes(2);
  });

  // A killed replica can no longer remove its entries: without a lease, its users would remain "online"
  // indefinitely for the whole studio.
  it('an entry whose lease has expired disappears from the list', async () => {
    await markOnline(1, 'a');
    await markOnline(2, 'b');
    expect(getOnlineUserIds()).toEqual([1, 2]);
    advance(PRESENCE_TTL_MS + 1);
    await __redisTesting.runHeartbeat();
    // Only the connections of this process have seen their lease renewed.
    expect(getOnlineUserIds()).toEqual([1, 2]);
  });

  it('the entry of a vanished replica expires, that of this process is renewed', async () => {
    await markOnline(1, 'local');
    // Entry written "by another replica", with a lease about to expire.
    await redis.call('ZADD', 'review:presence:online', Date.now() + 1_000, '99|distant');
    await __redisTesting.runHeartbeat();
    expect(getOnlineUserIds()).toEqual([1, 99]);
    advance(2_000);
    await __redisTesting.runHeartbeat();
    expect(getOnlineUserIds()).toEqual([1]);
  });

  it('the notification from another replica refreshes the local mirror', async () => {
    await markOnline(1, 'local');
    await redis.call('ZADD', 'review:presence:online', Date.now() + PRESENCE_TTL_MS, '7|ailleurs');
    __redisTesting.deliver('review:presence:online', 'online');
    await vi.waitFor(() => expect(getOnlineUserIds()).toEqual([1, 7]));
  });

  // A replica carrying no socket would never have woken up: the administration page it serves would have
  // announced "nobody online".
  it('seeds the synchronisation at start-up, without a local socket', async () => {
    await redis.call('ZADD', 'review:presence:online', Date.now() + PRESENCE_TTL_MS, '4|ailleurs');
    expect(getOnlineUserIds()).toEqual([]);
    startPresenceSync();
    await vi.waitFor(() => expect(getOnlineUserIds()).toEqual([4]));
  });

  it('publishes on the channel so that the other replicas broadcast too', async () => {
    await markOnline(1, 'a');
    expect(redis.published).toContainEqual({ channel: 'review:presence:online', payload: 'online' });
  });
});

describe('presence per review', () => {
  it('adds then removes a viewer', async () => {
    expect((await joinReview(1001, viewer(1), 'c1')).map((v) => v.id)).toEqual([1]);
    expect((await joinReview(1001, viewer(2), 'c2')).map((v) => v.id)).toEqual([1, 2]);
    expect((await leaveReview(1001, 1, 'c1')).map((v) => v.id)).toEqual([2]);
    expect(await leaveReview(1001, 2, 'c2')).toEqual([]);
    expect(await getReviewViewers(1001)).toEqual([]);
  });

  it('counts multiple tabs: removes only at the last leave', async () => {
    await joinReview(1002, viewer(5), 'c1');
    await joinReview(1002, viewer(5), 'c2');
    expect((await leaveReview(1002, 5, 'c1')).map((v) => v.id)).toEqual([5]);
    expect(await leaveReview(1002, 5, 'c2')).toEqual([]);
  });

  it('isolates reviews from one another and ignores an unknown leave', async () => {
    await joinReview(2001, viewer(1), 'c1');
    await joinReview(2002, viewer(2), 'c2');
    expect((await getReviewViewers(2001)).map((v) => v.id)).toEqual([1]);
    expect((await getReviewViewers(2002)).map((v) => v.id)).toEqual([2]);
    expect((await leaveReview(2001, 99, 'inconnu')).map((v) => v.id)).toEqual([1]);
  });

  it('refreshes the identity on re-join (most recent presigned avatar)', async () => {
    await joinReview(3001, viewer(7, 'Ancien Nom'), 'c1');
    const updated = { ...viewer(7, 'Nouveau Nom'), avatarUrl: 'https://exemple/avatar.png' };
    advance(10);
    expect(await joinReview(3001, updated, 'c2')).toEqual([updated]);
  });

  it('keeps the arrival order, whatever the storage order', async () => {
    await joinReview(4001, viewer(30), 'c30');
    advance(5);
    await joinReview(4001, viewer(10), 'c10');
    advance(5);
    await joinReview(4001, viewer(20), 'c20');
    expect((await getReviewViewers(4001)).map((v) => v.id)).toEqual([30, 10, 20]);
  });

  it('a viewer whose lease has expired is no longer listed and its entry is cleaned up', async () => {
    await joinReview(5001, viewer(1), 'c1');
    advance(PRESENCE_TTL_MS + 1);
    expect(await getReviewViewers(5001)).toEqual([]);
    await vi.waitFor(() => expect(redis.peek('review:presence:review:5001')).toBeUndefined());
  });

  it('sees the viewers who joined from another replica', async () => {
    await joinReview(6001, viewer(1), 'c1');
    const stored = JSON.stringify({ v: viewer(2), j: Date.now() + 1, e: Date.now() + PRESENCE_TTL_MS });
    await redis.call('HSET', 'review:presence:review:6001', '2|distant', stored);
    expect((await getReviewViewers(6001)).map((v) => v.id)).toEqual([1, 2]);
  });

  it('Redis silent: the local view is displayed rather than an empty room', async () => {
    await joinReview(7001, viewer(1), 'c1');
    redis.failing = true;
    expect((await getReviewViewers(7001)).map((v) => v.id)).toEqual([1]);
  });
});
