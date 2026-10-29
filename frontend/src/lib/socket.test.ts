// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Options actually passed to socket.io by `getSocket`. */
interface SocketOpts {
  auth: (cb: (data: object) => void) => void;
  query?: Record<string, string>;
  transports?: string[];
}
interface FakeSocket {
  opts: SocketOpts;
  disconnect: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}

// `vi.hoisted`: the mock factory runs before the file's `const` declarations are initialized,
// so it can only capture state hoisted along with it.
const state = vi.hoisted(() => ({ created: [] as unknown[] }));

vi.mock('socket.io-client', () => ({
  io: (_url: string, opts: SocketOpts) => {
    const socket = { opts, disconnect: vi.fn(), emit: vi.fn() };
    state.created.push(socket);
    return socket;
  },
}));

import { getSocket, disconnectSocket, emitActivity } from './socket';

const created = state.created as FakeSocket[];

/** Reads the auth payload that socket.io would send at connection time. */
function readAuth(socket: FakeSocket): object {
  let payload: object = {};
  socket.opts.auth((data) => {
    payload = data;
  });
  return payload;
}

beforeEach(() => {
  disconnectSocket();
  created.length = 0;
  localStorage.clear();
});

describe('getSocket', () => {
  it('reuses the same instance', () => {
    localStorage.setItem('token', 'jwt-1');
    expect(getSocket()).toBe(getSocket());
    expect(created).toHaveLength(1);
  });

  it('passes the token in `auth` and never in the query string', () => {
    localStorage.setItem('token', 'jwt-1');
    getSocket();
    expect(created[0].opts.query).toBeUndefined();
    expect(readAuth(created[0])).toEqual({ token: 'jwt-1' });
  });

  it('rereads the token on each connection (renewal taken into account)', () => {
    localStorage.setItem('token', 'jwt-1');
    getSocket();
    localStorage.setItem('token', 'jwt-2');
    expect(readAuth(created[0])).toEqual({ token: 'jwt-2' });
  });

  it('without a session: empty payload rather than a `null` token', () => {
    getSocket();
    expect(readAuth(created[0])).toEqual({ token: '' });
  });
});

describe('disconnectSocket', () => {
  it('closes the channel and opens a new one for the next account', () => {
    localStorage.setItem('token', 'jwt-1');
    const first = getSocket();
    disconnectSocket();
    expect(created[0].disconnect).toHaveBeenCalledTimes(1);

    localStorage.setItem('token', 'jwt-2');
    const second = getSocket();
    expect(second).not.toBe(first);
    expect(created).toHaveLength(2);
    expect(readAuth(created[1])).toEqual({ token: 'jwt-2' });
  });

  it('has no effect when no socket is open', () => {
    expect(() => {
      disconnectSocket();
    }).not.toThrow();
    expect(created).toHaveLength(0);
  });
});

describe('emitActivity', () => {
  it('emits on the current socket, and nothing after closing', () => {
    getSocket();
    emitActivity();
    expect(created[0].emit).toHaveBeenCalledWith('activity');
    disconnectSocket();
    emitActivity();
    expect(created[0].emit).toHaveBeenCalledTimes(1);
  });
});
