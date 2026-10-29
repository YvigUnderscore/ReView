// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __redisTesting, enableRedisTransport } from '../lib/redis';
import { createFakeRedis, type FakeRedis } from '../lib/redisFake';
import {
  parseLiveKey,
  joinLive,
  leaveLive,
  handoffLive,
  setCoHost,
  canDriveLive,
  isLiveDriver,
  claimDrive,
  getLiveState,
  getLiveProjectId,
  listLiveSessions,
  scheduleLiveLeave,
  cancelLiveLeave,
  resetLiveSessions,
  startLiveSync,
  LIVE_PARTICIPANT_TTL_MS,
  __liveTesting,
  type LiveParticipant,
} from './LiveSessionService';

const p = (id: number): LiveParticipant => ({
  id,
  displayName: `User ${id}`,
  initials: `U${id}`,
  avatarUrl: null,
});

let redis: FakeRedis;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-22T10:00:00Z'));
  __redisTesting.reset();
  resetLiveSessions();
  redis = createFakeRedis();
  __redisTesting.setClient(redis);
  enableRedisTransport();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Advances the clock without triggering a timer. */
const advance = (ms: number): void => {
  vi.setSystemTime(new Date(Date.now() + ms));
};

/** Simulates a restart (or a second replica): empty local state, Redis intact. */
async function asFreshReplica(): Promise<void> {
  resetLiveSessions();
  await __liveTesting.reloadAll();
}

describe('parseLiveKey (33.B)', () => {
  it('accepts media:<id> and playlist:<id>', () => {
    expect(parseLiveKey('media:12')).toEqual({ type: 'media', id: 12 });
    expect(parseLiveKey('playlist:3')).toEqual({ type: 'playlist', id: 3 });
  });
  it('rejects malformed keys', () => {
    for (const bad of ['media:', 'media:0', 'media:-1', 'shot:4', 'media:1e3', 42, null, 'media:1;drop'])
      expect(parseLiveKey(bad)).toBeNull();
  });
});

describe('joinLive / leaveLive (33.B)', () => {
  it('the first arrival becomes pilot AND driver, the following ones spectators', async () => {
    const s1 = await joinLive('media:1', p(10));
    expect(s1.state.pilotId).toBe(10);
    expect(s1.state.driverId).toBe(10);
    expect(s1.created).toBe(true);
    const s2 = await joinLive('media:1', p(20));
    expect(s2.state.pilotId).toBe(10);
    expect(s2.created).toBe(false);
    expect(s2.state.participants.map((x) => x.id)).toEqual([10, 20]);
  });

  it('re-join of the same user: idempotent (no duplicate)', async () => {
    await joinLive('media:1', p(10));
    const s = await joinLive('media:1', p(10));
    expect(s.state.participants).toHaveLength(1);
  });

  it('departure of the pilot: control passes to the first co-pilot, otherwise to the oldest', async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
    await joinLive('media:1', p(30));
    await setCoHost('media:1', 10, 30, true);
    const s = await leaveLive('media:1', 10);
    expect(s?.pilotId).toBe(30);
    expect(s?.coHostIds).toEqual([]);
    expect(s?.driverId).toBe(30);
  });

  it('last departure: the session is closed', async () => {
    await joinLive('media:1', p(10));
    expect(await leaveLive('media:1', 10)).toBeNull();
    expect(getLiveState('media:1')).toBeNull();
  });

  it('leave by a non-participant: no-op (null), the session survives', async () => {
    await joinLive('media:1', p(10));
    expect(await leaveLive('media:1', 99)).toBeNull();
    expect(getLiveState('media:1')?.participants).toHaveLength(1);
  });
});

describe('handoffLive (33.B)', () => {
  beforeEach(async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
  });

  it('the pilot gives control to a participant present (driver follows)', async () => {
    const s = await handoffLive('media:1', 10, 20);
    expect(s?.pilotId).toBe(20);
    expect(s?.driverId).toBe(20);
  });

  it('refused if the emitter is not the pilot or if the target is absent', async () => {
    expect(await handoffLive('media:1', 20, 10)).toBeNull();
    expect(await handoffLive('media:1', 10, 99)).toBeNull();
    expect(getLiveState('media:1')?.pilotId).toBe(10);
  });
});

describe('co-pilots & driver (CP-HUMAIN 33 feedback)', () => {
  beforeEach(async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
    await joinLive('media:1', p(30));
  });

  it('only the pilot names/removes a co-pilot (target present, not themselves)', async () => {
    expect(await setCoHost('media:1', 20, 30, true)).toBeNull();
    expect(await setCoHost('media:1', 10, 10, true)).toBeNull();
    expect(await setCoHost('media:1', 10, 99, true)).toBeNull();
    const s = await setCoHost('media:1', 10, 20, true);
    expect(s?.coHostIds).toEqual([20]);
    expect(canDriveLive('media:1', 20)).toBe(true);
    expect(canDriveLive('media:1', 30)).toBe(false);
  });

  it('claimDrive: a co-pilot who interacts becomes driver; a spectator does not', async () => {
    await setCoHost('media:1', 10, 20, true);
    expect(await claimDrive('media:1', 30)).toBeNull();
    const s = await claimDrive('media:1', 20);
    expect(s?.driverId).toBe(20);
    expect(isLiveDriver('media:1', 20)).toBe(true);
    // Already driver → no new state (no re-broadcast).
    expect(await claimDrive('media:1', 20)).toBeNull();
    // The pilot can take control back by interacting.
    expect((await claimDrive('media:1', 10))?.driverId).toBe(10);
  });

  it('removing the driver\'s co-piloting → control returns to the pilot', async () => {
    await setCoHost('media:1', 10, 20, true);
    await claimDrive('media:1', 20);
    const s = await setCoHost('media:1', 10, 20, false);
    expect(s?.coHostIds).toEqual([]);
    expect(s?.driverId).toBe(10);
  });

  it('departure of the co-pilot driver → control returns to the pilot', async () => {
    await setCoHost('media:1', 10, 20, true);
    await claimDrive('media:1', 20);
    const s = await leaveLive('media:1', 20);
    expect(s?.driverId).toBe(10);
  });

  // Hot path: `live:sync` comes back here several times per second. A Redis round trip on each frame would
  // make playback stutter for the whole room.
  it('claimDrive on a driver already in place does not touch Redis', async () => {
    await claimDrive('media:1', 20);
    const before = redis.commandCounts.get('SET') ?? 0;
    expect(await claimDrive('media:1', 10)).toBeNull();
    expect(redis.commandCounts.get('SET') ?? 0).toBe(before);
  });
});

describe('metadata & list of sessions per project (33 feedback — LIVE badges)', () => {
  it('the metadata is set at creation and kept at the following joins', async () => {
    await joinLive('media:1', p(10), { projectId: 7, mediaId: 1, versionId: 3 });
    await joinLive('media:1', p(20), { projectId: 99, mediaId: 1 }); // ignored (already set)
    expect(getLiveProjectId('media:1')).toBe(7);
    const sessions = listLiveSessions(7);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      key: 'media:1',
      mediaId: 1,
      versionId: 3,
      participantCount: 2,
    });
    expect(sessions[0]?.pilot?.id).toBe(10);
  });

  it('only lists the requested project; closed session → disappears', async () => {
    await joinLive('media:1', p(10), { projectId: 7, mediaId: 1 });
    await joinLive('playlist:2', p(20), { projectId: 8, playlistId: 2 });
    expect(listLiveSessions(7).map((s) => s.key)).toEqual(['media:1']);
    await leaveLive('media:1', 10);
    expect(listLiveSessions(7)).toEqual([]);
    expect(getLiveProjectId('media:1')).toBeNull();
  });
});

describe('disconnection grace (33 feedback — F5 keeps the pilot role)', () => {
  it('re-join during the grace period: the departure is cancelled, the pilot keeps control', async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(cancelLiveLeave('media:1', 10)).toBe(true);
    const s = await joinLive('media:1', p(10));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onLeft).not.toHaveBeenCalled();
    expect(s.state.pilotId).toBe(10);
    expect(getLiveState('media:1')?.pilotId).toBe(10);
  });

  it('grace expired: the departure is applied and notified (control handed over)', async () => {
    await joinLive('media:1', p(10));
    await joinLive('media:1', p(20));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onLeft).toHaveBeenCalledOnce();
    expect(onLeft.mock.calls[0]?.[0]?.pilotId).toBe(20);
    expect(cancelLiveLeave('media:1', 10)).toBe(false);
  });

  it('rescheduling: a second schedule replaces the first (a single departure)', async () => {
    await joinLive('media:1', p(10));
    const onLeft = vi.fn();
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    await vi.advanceTimersByTimeAsync(3000);
    scheduleLiveLeave('media:1', 10, onLeft, 5000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(onLeft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLeft).toHaveBeenCalledOnce();
  });
});

describe('shared state: restart, second replica, leases', () => {
  it('a room survives the server restarting', async () => {
    await joinLive('playlist:9', p(10), { projectId: 4, playlistId: 9 });
    await joinLive('playlist:9', p(20), { projectId: 4, playlistId: 9 });
    await setCoHost('playlist:9', 10, 20, true);

    await asFreshReplica();

    const state = getLiveState('playlist:9');
    expect(state?.pilotId).toBe(10);
    expect(state?.coHostIds).toEqual([20]);
    expect(state?.participants.map((x) => x.id)).toEqual([10, 20]);
    expect(listLiveSessions(4).map((s) => s.key)).toEqual(['playlist:9']);
  });

  it('a join coming from another replica is not declared "created" twice', async () => {
    const first = await joinLive('media:5', p(10), { projectId: 1, mediaId: 5 });
    expect(first.created).toBe(true);
    // Fresh replica: its mirror is empty, but Redis is authoritative.
    await asFreshReplica();
    resetLiveSessions();
    const second = await joinLive('media:5', p(20), { projectId: 1, mediaId: 5 });
    expect(second.created).toBe(false);
    expect(second.state.pilotId).toBe(10);
  });

  // A killed replica can no longer remove its participants: without a lease, the room would remain populated
  // with ghosts, pilot included — hence impossible to steer.
  it('a participant whose lease has expired is removed and control passes on', async () => {
    await joinLive('media:6', p(10), { projectId: 2, mediaId: 6 });
    await joinLive('media:6', p(20), { projectId: 2, mediaId: 6 });
    advance(LIVE_PARTICIPANT_TTL_MS + 1);
    // Only one of the two shows up: the other was carried by the vanished replica.
    const state = (await joinLive('media:6', p(20), { projectId: 2, mediaId: 6 })).state;
    expect(state.participants.map((x) => x.id)).toEqual([20]);
    expect(state.pilotId).toBe(20);
  });

  it('the heartbeat renews the lease of this process\'s participants', async () => {
    await joinLive('media:7', p(10));
    advance(LIVE_PARTICIPANT_TTL_MS - 1_000);
    await __redisTesting.runHeartbeat();
    advance(2_000);
    await __liveTesting.reloadAll();
    expect(getLiveState('media:7')?.participants.map((x) => x.id)).toEqual([10]);
  });

  it('a fully expired room is erased from Redis and from the index', async () => {
    await joinLive('media:8', p(10), { projectId: 3, mediaId: 8 });
    resetLiveSessions(); // the replica carrying it disappears
    advance(LIVE_PARTICIPANT_TTL_MS + 1);
    await __liveTesting.reloadAll();
    expect(getLiveState('media:8')).toBeNull();
    expect(await redis.call('SMEMBERS', 'review:live:index')).toEqual([]);
    expect(await redis.call('GET', 'review:live:s:media:8')).toBeNull();
  });

  it('seeds the LIVE badges at start-up, without waiting for a local join', async () => {
    await joinLive('media:11', p(10), { projectId: 5, mediaId: 11 });
    resetLiveSessions();
    expect(listLiveSessions(5)).toEqual([]);
    startLiveSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(listLiveSessions(5).map((s) => s.key)).toEqual(['media:11']);
  });

  it('publishes the touched key so that the other replicas resynchronise', async () => {
    await joinLive('media:9', p(10));
    expect(redis.published).toContainEqual({ channel: 'review:live', payload: 'media:9' });
  });

  it('Redis silent: the room degrades without throwing or blocking', async () => {
    redis.failing = true;
    const { state, created } = await joinLive('media:10', p(10));
    expect(created).toBe(false);
    expect(state.participants.map((x) => x.id)).toEqual([10]);
    expect(await leaveLive('media:10', 10)).toBeNull();
  });
});
