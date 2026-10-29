// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAuthUser, isSessionActive } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  isSessionActive: vi.fn(),
}));

vi.mock('../lib/userCache', () => ({ getAuthUser }));
// `SocketService` also imports the immediate-revocation channel contract (A3-02): an export missing
// from a double makes vitest fail on access, even if this file does not exercise it.
vi.mock('../lib/sessions', () => ({
  isSessionActive,
  SESSION_REVOCATION_CHANNEL: 'review:session-revoked',
  decodeSessionRevocation: vi.fn(() => []),
  markSessionsRevoked: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { Role } from '@prisma/client';
import { revalidateSocket, sweepSockets, type AuthedSocket } from './SocketService';

const active = { id: 7, email: 'sup@studio.com', role: Role.SUPERVISOR, disabledAt: null };

/** Minimal socket: only the identity set at handshake and the disconnection matter here. */
const socketOf = (over: Partial<AuthedSocket> = {}): AuthedSocket =>
  ({
    user: { id: 7, email: 'sup@studio.com', role: Role.SUPERVISOR },
    authSid: 'sid-1',
    disconnect: vi.fn(),
    ...over,
  }) as unknown as AuthedSocket;

beforeEach(() => {
  vi.clearAllMocks();
  isSessionActive.mockResolvedValue(true);
  getAuthUser.mockResolvedValue(active);
});

/**
 * A3-02: `authenticateSocket` only runs at handshake: afterwards `socket.user` is frozen and the connection
 * lives as long as the transport holds, that is, for days. Revoking a session or demoting a role cut the API
 * within thirty seconds without changing anything on the real-time channel: the tab left open kept receiving
 * the project's internal comments, and its former role reopened `join_project` for it.
 */
describe('revalidateSocket: the gate is replayed', () => {
  it('closes a connection whose session has been revoked', async () => {
    isSessionActive.mockResolvedValue(false);
    expect(await revalidateSocket(socketOf())).toBe(false);
  });

  it('closes a connection whose account has been deactivated', async () => {
    getAuthUser.mockResolvedValue({ ...active, disabledAt: new Date() });
    expect(await revalidateSocket(socketOf())).toBe(false);
  });

  it('closes a connection whose account has disappeared', async () => {
    getAuthUser.mockResolvedValue(null);
    expect(await revalidateSocket(socketOf())).toBe(false);
  });

    /**
     * The hard point: `join_project` reads `socket.user.role`, and `resolveProjectAccess` grants global access
     * to ADMIN as well as SUPERVISOR. Checking without rewriting would have let the former supervisor join any
     * project from their open tab.
     */
  it('replaces the frozen role with the current role', async () => {
    getAuthUser.mockResolvedValue({ ...active, role: Role.CLIENT });
    const socket = socketOf();
    expect(await revalidateSocket(socket)).toBe(true);
    expect(socket.user?.role).toBe(Role.CLIENT);
  });

    // A token from before phase 36 has no session to check: nothing can revoke it.
  it('closes a connection with no identified session', async () => {
    expect(await revalidateSocket(socketOf({ authSid: undefined }))).toBe(false);
  });

    // A share guest has neither session nor role: their access rests on the ShareLink, rechecked
    // on the API side at every read. Nothing to replay, and above all nothing to cut.
  it('leaves alone a guest who arrived through a share link', async () => {
    const guest = socketOf({ user: undefined, shareProjectId: 3 });
    expect(await revalidateSocket(guest)).toBe(true);
    expect(isSessionActive).not.toHaveBeenCalled();
  });
});

describe('sweepSockets: sweep of the replica', () => {
  const serverOf = (...sockets: AuthedSocket[]) =>
    ({ sockets: { sockets: new Map(sockets.map((s, i) => [String(i), s])) } }) as never;

  it('disconnects those that are no longer valid, keeps the others', async () => {
    const revoked = socketOf({ authSid: 'morte' });
    const kept = socketOf({ authSid: 'sid-1' });
    isSessionActive.mockImplementation((sid: string) => Promise.resolve(sid !== 'morte'));

    await sweepSockets(serverOf(revoked, kept));

    expect(revoked.disconnect).toHaveBeenCalledWith(true);
    expect(kept.disconnect).not.toHaveBeenCalled();
  });

    // A database or Redis outage must not disconnect the whole studio: the check that fails keeps the
    // connection (the API, for its part, fails closed).
  it('keeps the connection when the check itself fails', async () => {
    isSessionActive.mockRejectedValue(new Error('redis down'));
    const socket = socketOf();

    await sweepSockets(serverOf(socket));

    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
