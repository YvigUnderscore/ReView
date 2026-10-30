// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeIo, getAuthUser, isSessionActive, checkProjectAccess } = vi.hoisted(() => ({
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
}));

// `new SocketServer(...)`: the double must be callable with `new`, hence the classic function
// that returns the object rather than an arrow function.
vi.mock('socket.io', () => ({
  Server: vi.fn(function FakeServer() {
    return fakeIo;
  }),
}));
vi.mock('@socket.io/redis-adapter', () => ({ createAdapter: vi.fn(() => vi.fn()) }));
vi.mock('../lib/redis', () => ({
  createRedisClient: vi.fn(() => ({ quit: vi.fn(async () => undefined), disconnect: vi.fn() })),
  enableRedisTransport: vi.fn(),
  // Immediate revocation channel (A3-02): this file does not exercise it, but `initSocket`
  // subscribes to it; without the double the connection would not even open.
  subscribeRedis: vi.fn(),
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
vi.mock('../lib/sessions', () => ({
  isSessionActive,
  SESSION_REVOCATION_CHANNEL: 'review:session-revoked',
  decodeSessionRevocation: vi.fn(() => []),
  markSessionsRevoked: vi.fn(),
}));
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
import { initSocket } from './SocketService';

type Listener = (...args: unknown[]) => unknown;

/** Test socket: only what the server asks of it is kept. */
const fakeSocket = () => {
  const listeners = new Map<string, Listener>();
  return {
    id: 'sock-1',
    user: { id: 7, email: 'sup@studio.com', role: Role.SUPERVISOR },
    authSid: 'sid-1',
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    // Rate guard (A5-05): set at the head of `io.on('connection')`. This file does not
    // exercise it: the captured middleware is never replayed, so nothing is filtered here.
    use: vi.fn(),
    on: vi.fn((event: string, handler: Listener) => {
      listeners.set(event, handler);
    }),
    listeners,
  };
};

/** Wires up the server, opens a connection and returns the socket ready to receive events. */
const connect = () => {
  fakeIo.on.mockImplementation((event: string, handler: (socket: unknown) => void) => {
    if (event === 'connection') fakeIo.connection = handler;
  });
  initSocket({} as never);
  const socket = fakeSocket();
  fakeIo.connection!(socket);
  return socket;
};

beforeEach(() => {
  vi.clearAllMocks();
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
 * A3-02, the audit's scenario: a supervisor leaves the studio, the admin demotes them to CLIENT and then
 * revokes their sessions. Their HTTP requests fall to 401 within thirty seconds. Their tab left open,
 * however, kept its websocket, and `join_project` granted it any project, because the check read the role
 * FROZEN at handshake and `resolveProjectAccess` grants global access to ADMIN as well as SUPERVISOR.
 */
describe('join_project: the role is no longer the one from the handshake', () => {
  const joinProject = async (socket: ReturnType<typeof fakeSocket>, projectId: number) => {
    await socket.listeners.get('join_project')!(projectId);
  };

  it('joins the room of an accessible project', async () => {
    const socket = connect();
    await joinProject(socket, 42);
    expect(socket.join).toHaveBeenCalledWith('project_42');
  });

  it("checks access with the CURRENT role, not the token's", async () => {
    const socket = connect();
    getAuthUser.mockResolvedValue({
      id: 7,
      email: 'sup@studio.com',
      role: Role.CLIENT,
      disabledAt: null,
    });
    await joinProject(socket, 42);
    expect(checkProjectAccess).toHaveBeenCalledWith(7, Role.CLIENT, 42);
  });

  it('closes the connection when the session has been revoked', async () => {
    const socket = connect();
    isSessionActive.mockResolvedValue(false);
    await joinProject(socket, 42);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    // `socket.join('user_7')` happens at connection: it is the project room that must not
    // be joined.
    expect(socket.join).not.toHaveBeenCalledWith('project_42');
    expect(checkProjectAccess).not.toHaveBeenCalled();
  });

  it('closes the connection of a deactivated account', async () => {
    const socket = connect();
    getAuthUser.mockResolvedValue({
      id: 7,
      email: 'sup@studio.com',
      role: Role.SUPERVISOR,
      disabledAt: new Date(),
    });
    await joinProject(socket, 42);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalledWith('project_42');
  });
});
