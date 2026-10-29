// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The real-time channel is doubled: we check that it is closed on every account change, not the
// socket.io behaviour (covered by lib/socket.test.ts).
vi.mock('../../lib/socket', () => ({
  getSocket: vi.fn(),
  disconnectSocket: vi.fn(),
  emitActivity: vi.fn(),
}));

import { disconnectSocket } from '../../lib/socket';
import { api } from '../../lib/apiClient';
import { useAuth, type AuthUser } from './useAuth';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const user: AuthUser = {
  id: 1,
  email: 'a@b.c',
  name: 'A',
  displayName: 'A',
  initials: 'A',
  avatarUrl: null,
  status: 'AVAILABLE',
  role: 'ADMIN',
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(disconnectSocket).mockClear();
  localStorage.clear();
  useAuth.setState({ user: null, ready: false });
});

describe('useAuth', () => {
  it('login: stores the token and the user', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ token: 'jwt-1', user }));
    await useAuth.getState().login('a@b.c', 'pw');
    expect(localStorage.getItem('token')).toBe('jwt-1');
    expect(useAuth.getState().user?.email).toBe('a@b.c');
  });

  it('login with 2FA: returns the tmpToken without signing in (36.A)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ requires2fa: true, tmpToken: 'tmp-1' }));
    const r = await useAuth.getState().login('a@b.c', 'pw');
    expect(r.tmpToken).toBe('tmp-1');
    expect(localStorage.getItem('token')).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('verify2fa: exchanges the code for the session', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ token: 'jwt-2', refreshToken: 'r-2', user }));
    await useAuth.getState().verify2fa('tmp-1', '123456');
    expect(localStorage.getItem('token')).toBe('jwt-2');
    expect(localStorage.getItem('refreshToken')).toBe('r-2');
    expect(useAuth.getState().user?.id).toBe(1);
  });

  it('ssoLogin: stores the tokens then restores the profile via /me', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ user }));
    await useAuth.getState().ssoLogin('jwt-sso', 'r-sso');
    expect(localStorage.getItem('token')).toBe('jwt-sso');
    expect(localStorage.getItem('refreshToken')).toBe('r-sso');
    expect(useAuth.getState().user?.email).toBe('a@b.c');
  });

  it('logout: purges token and user', () => {
    localStorage.setItem('token', 'jwt-1');
    useAuth.setState({ user });
    useAuth.getState().logout();
    expect(localStorage.getItem('token')).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('init without token: ready without a network call', async () => {
    await useAuth.getState().init();
    expect(useAuth.getState().ready).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('init with a valid token: restores the session', async () => {
    localStorage.setItem('token', 'jwt-1');
    mockFetch.mockResolvedValue(jsonResponse({ user }));
    await useAuth.getState().init();
    expect(useAuth.getState().user?.id).toBe(1);
    expect(useAuth.getState().ready).toBe(true);
  });

  it('init with an invalid token: purges the token, still ready', async () => {
    localStorage.setItem('token', 'périmé');
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Token invalide' }, 401));
    await useAuth.getState().init();
    expect(localStorage.getItem('token')).toBeNull();
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().ready).toBe(true);
  });
});

describe('useAuth — canal temps réel', () => {
  it('logout: closes the socket of the account that leaves', () => {
    localStorage.setItem('token', 'jwt-1');
    mockFetch.mockResolvedValue(jsonResponse({}));
    useAuth.setState({ user });
    useAuth.getState().logout();
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });

  it('login: starts from a fresh socket (shared review-room workstation)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ token: 'jwt-2', refreshToken: 'r-2', user }));
    await useAuth.getState().login('a@b.c', 'pw');
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('refreshToken')).toBe('r-2');
  });

  it('setAuth: also closes the previous socket', () => {
    useAuth.getState().setAuth('jwt-3', user);
    expect(localStorage.getItem('token')).toBe('jwt-3');
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});

describe('useAuth — session expirée', () => {
  it('unrecoverable 401: purges the session, clears the state and closes the socket', async () => {
    localStorage.setItem('token', 'jwt-mort');
    localStorage.setItem('refreshToken', 'r-mort');
    useAuth.setState({ user, ready: true });
    // Everything answers 401, token renewal included: the session is dead.
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Non authentifié' }, 401));

    await expect(api.get('/api/projects')).rejects.toThrow(/session/i);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().ready).toBe(true);
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});
