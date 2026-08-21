// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Options réellement passées à socket.io par `getSocket`. */
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

// `vi.hoisted` : la fabrique du mock s'exécute avant l'initialisation des `const` du
// fichier, elle ne peut donc capturer qu'un état hissé avec elle.
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

/** Lit la charge d'authentification que socket.io réclamerait à la connexion. */
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
  it('réutilise la même instance', () => {
    localStorage.setItem('token', 'jwt-1');
    expect(getSocket()).toBe(getSocket());
    expect(created).toHaveLength(1);
  });

  it('passe le jeton dans `auth` et jamais dans la query string', () => {
    localStorage.setItem('token', 'jwt-1');
    getSocket();
    expect(created[0].opts.query).toBeUndefined();
    expect(readAuth(created[0])).toEqual({ token: 'jwt-1' });
  });

  it('relit le jeton à chaque connexion (renouvellement pris en compte)', () => {
    localStorage.setItem('token', 'jwt-1');
    getSocket();
    localStorage.setItem('token', 'jwt-2');
    expect(readAuth(created[0])).toEqual({ token: 'jwt-2' });
  });

  it('sans session : charge vide plutôt qu’un jeton `null`', () => {
    getSocket();
    expect(readAuth(created[0])).toEqual({ token: '' });
  });
});

describe('disconnectSocket', () => {
  it('ferme le canal et en rouvre un neuf au compte suivant', () => {
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

  it('est sans effet quand aucun socket n’est ouvert', () => {
    expect(() => {
      disconnectSocket();
    }).not.toThrow();
    expect(created).toHaveLength(0);
  });
});

describe('emitActivity', () => {
  it('émet sur le socket courant, et plus rien après fermeture', () => {
    getSocket();
    emitActivity();
    expect(created[0].emit).toHaveBeenCalledWith('activity');
    disconnectSocket();
    emitActivity();
    expect(created[0].emit).toHaveBeenCalledTimes(1);
  });
});
