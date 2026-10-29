// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fakeIo, getAuthUser, isSessionActive, checkProjectAccess, subscribeRedis, markSessionsRevoked } =
  vi.hoisted(() => ({
    fakeIo: {
      connection: null as null | ((socket: unknown) => void),
      adapter: vi.fn(),
      use: vi.fn(),
      on: vi.fn(),
      to: vi.fn(() => ({ emit: vi.fn() })),
      local: { emit: vi.fn() },
      sockets: { sockets: new Map<string, unknown>() },
    },
    getAuthUser: vi.fn(),
    isSessionActive: vi.fn(),
    checkProjectAccess: vi.fn(),
    subscribeRedis: vi.fn(),
    markSessionsRevoked: vi.fn(),
  }));

vi.mock('socket.io', () => ({
  Server: vi.fn(function FakeServer() {
    return fakeIo;
  }),
}));
vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: vi.fn(() => vi.fn()) }));
vi.mock('../lib/redis', () => ({
  createRedisClient: vi.fn(() => ({ quit: vi.fn(async () => undefined), disconnect: vi.fn() })),
  enableRedisTransport: vi.fn(),
  subscribeRedis,
}));
vi.mock('../lib/workerEvents', () => ({ subscribeWorkerEvents: vi.fn() }));
vi.mock('../lib/gracefulShutdown', () => ({
  registerShutdownTask: vi.fn(),
  SHUTDOWN_PHASE: { STOP_INTAKE: 10, DISCONNECT: 20 },
}));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForMedia: vi.fn() }));
vi.mock('../lib/userView', () => ({ toPublicUser: vi.fn() }));
vi.mock('../lib/userCache', () => ({ getAuthUser }));
// `socketRateLimit` is NOT mocked: wiring the real module is precisely what we want to verify.
// A double here would make the test pass without any limiter.
vi.mock('../lib/sessions', async (importOriginal) => {
    // The decoder is the production one (channel contract); only the side effects are mocked.
  const real = await importOriginal<typeof import('../lib/sessions')>();
  return {
    SESSION_REVOCATION_CHANNEL: real.SESSION_REVOCATION_CHANNEL,
    encodeSessionRevocation: real.encodeSessionRevocation,
    decodeSessionRevocation: real.decodeSessionRevocation,
    isSessionActive,
    markSessionsRevoked,
  };
});
vi.mock('../middleware/rbac', () => ({ checkProjectAccess }));
vi.mock('./NotificationService', () => ({ notifyPlaylistLiveStarted: vi.fn() }));
vi.mock('./PresenceService', () => ({
  markOnline: vi.fn(),
  markOffline: vi.fn(),
  touch: vi.fn(),
  setPresenceBroadcaster: vi.fn(),
  joinReview: vi.fn(),
  leaveReview: vi.fn(),
  getReviewViewers: vi.fn(),
  startPresenceSync: vi.fn(),
}));
vi.mock('./LiveSessionService', () => ({
  parseLiveKey: vi.fn(),
  joinLive: vi.fn(),
  leaveLive: vi.fn(),
  handoffLive: vi.fn(),
  setCoHost: vi.fn(),
  canDriveLive: vi.fn(),
  isLiveDriver: vi.fn(),
  claimDrive: vi.fn(),
  getLiveState: vi.fn(),
  getLiveProjectId: vi.fn(),
  scheduleLiveLeave: vi.fn(),
  cancelLiveLeave: vi.fn(),
  startLiveSync: vi.fn(),
}));

import { Role } from '@prisma/client';
import { encodeSessionRevocation, SESSION_REVOCATION_CHANNEL } from '../lib/sessions';
import { initSocket, disconnectRevokedSockets, type AuthedSocket } from './SocketService';

type Listener = (...args: unknown[]) => unknown;
type Middleware = (packet: unknown[], next: (err?: Error) => void) => void;

/**
 * Test socket. `use` captures the packet middleware: that is where the rate guard sits, and it is what
 * we want to be able to run without a real Socket.io server.
 */
const fakeSocket = (id = 'sock-1', authSid = 'sid-1') => {
  const listeners = new Map<string, Listener>();
  const middlewares: Middleware[] = [];
  return {
    id,
    user: { id: 7, email: 'sup@studio.com', role: Role.SUPERVISOR },
    authSid,
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    use: vi.fn((fn: Middleware) => {
      middlewares.push(fn);
    }),
    on: vi.fn((event: string, handler: Listener) => {
      listeners.set(event, handler);
    }),
    listeners,
    middlewares,
        /**
         * Replays an incoming packet through the middleware chain. Returns true if the packet reached the end,
         * that is, if the `socket.on` handler would have been called.
         */
    emit(event: string, ...args: unknown[]): boolean {
      for (const mw of middlewares) {
        let passed = false;
        mw([event, ...args], () => {
          passed = true;
        });
        if (!passed) return false;
      }
      return true;
    },
  };
};

const connect = (id?: string, authSid?: string) => {
  fakeIo.on.mockImplementation((event: string, handler: (socket: unknown) => void) => {
    if (event === 'connection') fakeIo.connection = handler;
  });
  initSocket({} as never);
  const socket = fakeSocket(id, authSid);
  fakeIo.connection!(socket);
  return socket;
};

beforeEach(() => {
  vi.clearAllMocks();
  fakeIo.sockets.sockets.clear();
  isSessionActive.mockResolvedValue(true);
  getAuthUser.mockResolvedValue({
    id: 7,
    email: 'sup@studio.com',
    role: Role.SUPERVISOR,
    disabledAt: null,
  });
  checkProjectAccess.mockResolvedValue(true);
});

/**
 * A5-05: the `lib/socketRateLimit` module existed, with its tests, but nobody called it: the Socket.io
 * surface had NO limit, and the audit re-measured it directly (160,500 events in 5 s over a single websocket,
 * without disconnection). An unwired fix is an unmade fix: this block checks the wiring, not the algorithm
 * (which has its own tests in `lib/socketRateLimit.test.ts`).
 */
describe('io.on(connection): the rate guard is really wired up', () => {
  it('installs a packet middleware on every accepted connection', () => {
    const socket = connect();
    expect(socket.use).toHaveBeenCalled();
    expect(socket.middlewares).toHaveLength(1);
  });

  it('stops a `join_review` loop BEFORE the handler (so before Postgres)', () => {
    const socket = connect();
        // 240 tokens / 12 per join = 20 passes, then nothing until the bucket refills.
    for (let i = 0; i < 20; i += 1) expect(socket.emit('join_review', i)).toBe(true);
    expect(socket.emit('join_review', 21)).toBe(false);
  });

  it('closes the connection on sustained overflow', () => {
    const socket = connect();
    for (let i = 0; i < 600; i += 1) socket.emit('join_review', i);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

    /**
     * The counter-test that matters: a limit that cuts off a client-side projection driver would be
     * disarmed at the first complaint. We replay ten seconds of the chattiest regime measured on the front end:
     * periodic broadcast at 30 Hz, cursor at about 20 Hz, sustained typing, and nothing must be dropped.
     */
  it('lets ten seconds of dailies driver traffic through (30 Hz + cursor + typing)', () => {
        // Only the clock is faked: `initSocket` sets a `setInterval(...).unref()`, which a fake timer
        // would replace with an identifier lacking `unref`.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const socket = connect();
    let dropped = 0;
    for (let ms = 0; ms < 10_000; ms += 1) {
      vi.setSystemTime(ms);
            // About 30 Hz: periodic broadcast of the driver (`syncHz` capped at 30 on the front end).
      if (ms % 33 === 0 && !socket.emit('live:sync', 'k', { mediaId: 1, t: 12.5, playing: true }))
        dropped += 1;
            // 20 Hz: shared cursor (`POINTER_INTERVAL_MS = 50`), on the same channel.
      if (
        ms % 50 === 0 &&
        !socket.emit('live:sync', 'k', { mediaId: 1, pointer: { userId: 7, x: 0.4, y: 0.6 } })
      )
        dropped += 1;
            // 10 Hz: `activity` is emitted on every keystroke, without client-side throttling.
      if (ms % 100 === 0 && !socket.emit('activity')) dropped += 1;
    }
    expect(dropped).toBe(0);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});

/**
 * A3-02, immediate part: periodic revalidation left a departing user's open tab up to a minute of grace:
 * a minute of internal comments and presigned URLs.
 */
describe('immediate revocation: the channel is subscribed and cuts the right connections', () => {
  const deliver = (sids: string[]) => {
    const handler = subscribeRedis.mock.calls.find(
      (c: unknown[]) => c[0] === SESSION_REVOCATION_CHANNEL,
    )?.[1] as ((raw: string) => void) | undefined;
    expect(handler, 'aucun abonnement au canal de révocation').toBeDefined();
    handler!(encodeSessionRevocation(sids));
  };

  it('subscribes the service to the revocation channel', () => {
    initSocket({} as never);
    expect(subscribeRedis).toHaveBeenCalledWith(SESSION_REVOCATION_CHANNEL, expect.any(Function));
  });

  it('closes the connection of the revoked sid and spares the others', () => {
    connect();
    const revoked = fakeSocket('sock-a', 'sid-morte');
    const kept = fakeSocket('sock-b', 'sid-vivante');
    fakeIo.sockets.sockets.set('a', revoked);
    fakeIo.sockets.sockets.set('b', kept);

    deliver(['sid-morte']);

    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(kept.disconnect).not.toHaveBeenCalled();
  });

    /**
     * Closing the socket without dropping the cache would be cosmetic: `isSessionActive` would still answer
     * "alive" for thirty seconds and the API would reopen the door.
     */
  it('also invalidates this replica\'s validity cache', () => {
    connect();
    deliver(['sid-morte']);
    expect(markSessionsRevoked).toHaveBeenCalledWith(['sid-morte']);
  });

  it('ignores an unreadable message without closing anything', () => {
    connect();
    const victime = fakeSocket('sock-a', 'sid-1');
    fakeIo.sockets.sockets.set('a', victime);
    const handler = subscribeRedis.mock.calls.find(
      (c: unknown[]) => c[0] === SESSION_REVOCATION_CHANNEL,
    )![1] as (raw: string) => void;

    expect(() => handler('{pas du json')).not.toThrow();
    expect(victime.disconnect).not.toHaveBeenCalled();
    expect(markSessionsRevoked).not.toHaveBeenCalled();
  });
});

describe('disconnectRevokedSockets', () => {
  const serverOf = (...sockets: unknown[]) =>
    ({ sockets: { sockets: new Map(sockets.map((s, i) => [String(i), s])) } }) as never;

  it('matches on the sid, not on the user (the spared session stays open)', () => {
        // Same account, two tabs: "revoke my other sessions" must not disconnect the author of the
        // action: their session is not in the published list.
    const autre = fakeSocket('sock-a', 'sid-autre');
    const courante = fakeSocket('sock-b', 'sid-courante');

    expect(disconnectRevokedSockets(serverOf(autre, courante), ['sid-autre'])).toBe(1);
    expect(autre.disconnect).toHaveBeenCalledWith(true);
    expect(courante.disconnect).not.toHaveBeenCalled();
  });

    // A share guest has no session: nothing to match, and above all nothing to cut.
  it('leaves a connection without a session alone', () => {
    const invite = { ...fakeSocket('sock-c'), authSid: undefined } as unknown as AuthedSocket;
    expect(disconnectRevokedSockets(serverOf(invite), ['sid-morte'])).toBe(0);
    expect(invite.disconnect).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
