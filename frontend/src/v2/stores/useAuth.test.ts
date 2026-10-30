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
import { api, clearTokens, getToken, setTokens } from '../../lib/apiClient';
import { SSO_COOKIE_MARKER, useAuth, type AuthUser } from './useAuth';

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

/** Server double by path; anything not listed answers 401. */
function stubRoutes(routes: Record<string, () => Response>) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    return Promise.resolve(routes[key]?.() ?? jsonResponse({ error: 'Not authenticated' }, 401));
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(disconnectSocket).mockClear();
  localStorage.clear();
  clearTokens();
  useAuth.setState({ user: null, ready: false });
});

describe('useAuth', () => {
  it('login: keeps the access token in memory and the user', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ token: 'jwt-1', user }));
    await useAuth.getState().login('a@b.c', 'pw');
    expect(getToken()).toBe('jwt-1');
    expect(localStorage.length).toBe(0);
    expect(useAuth.getState().user?.email).toBe('a@b.c');
  });

  it('login with 2FA: returns the tmpToken without signing in (36.A)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ requires2fa: true, tmpToken: 'tmp-1' }));
    const r = await useAuth.getState().login('a@b.c', 'pw');
    expect(r.tmpToken).toBe('tmp-1');
    expect(getToken()).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('verify2fa: exchanges the code for the session', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ token: 'jwt-2', user }));
    await useAuth.getState().verify2fa('tmp-1', '123456');
    expect(getToken()).toBe('jwt-2');
    expect(useAuth.getState().user?.id).toBe(1);
  });

  it('ssoLogin with an access token (invitation): keeps it, then restores the profile via /me', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ user }));
    await useAuth.getState().ssoLogin('jwt-sso', 'ignored-legacy-refresh');
    expect(getToken()).toBe('jwt-sso');
    expect(localStorage.length).toBe(0);
    expect(useAuth.getState().user?.email).toBe('a@b.c');
  });

  it('ssoLogin from an SSO return: the access token comes from the refresh cookie', async () => {
    stubRoutes({
      'POST /api/auth/refresh': () => jsonResponse({ token: 'jwt-cookie' }),
      'GET /api/auth/me': () => jsonResponse({ user }),
    });
    await useAuth.getState().ssoLogin(SSO_COOKIE_MARKER);
    expect(getToken()).toBe('jwt-cookie');
    expect(useAuth.getState().user?.id).toBe(1);
  });

  it('ssoLogin from an SSO return without a cookie: fails, no session', async () => {
    stubRoutes({});
    await expect(useAuth.getState().ssoLogin(SSO_COOKIE_MARKER)).rejects.toThrow();
    expect(getToken()).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('logout: revokes through the refresh cookie, purges token and user', () => {
    setTokens('jwt-1');
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    useAuth.setState({ user });
    useAuth.getState().logout();
    expect(getToken()).toBeNull();
    expect(useAuth.getState().user).toBeNull();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/refresh');
    expect(init.method).toBe('DELETE');
  });

  it('init without a session cookie: ready, no user', async () => {
    stubRoutes({});
    await useAuth.getState().init();
    expect(useAuth.getState().ready).toBe(true);
    expect(useAuth.getState().user).toBeNull();
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(['/api/auth/refresh']);
  });

  it('init after a reload: restores the session from the refresh cookie', async () => {
    stubRoutes({
      'POST /api/auth/refresh': () => jsonResponse({ token: 'jwt-1' }),
      'GET /api/auth/me': () => jsonResponse({ user }),
    });
    await useAuth.getState().init();
    expect(getToken()).toBe('jwt-1');
    expect(useAuth.getState().user?.id).toBe(1);
    expect(useAuth.getState().ready).toBe(true);
  });

  it('init with a token already in memory: no renewal, profile only', async () => {
    setTokens('jwt-1');
    mockFetch.mockResolvedValue(jsonResponse({ user }));
    await useAuth.getState().init();
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual(['/api/auth/me']);
    expect(useAuth.getState().user?.id).toBe(1);
  });

  it('init with an invalid token: purges the token, still ready', async () => {
    setTokens('périmé');
    stubRoutes({});
    await useAuth.getState().init();
    expect(getToken()).toBeNull();
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().ready).toBe(true);
  });
});

describe('useAuth — canal temps réel', () => {
  it('logout: closes the socket of the account that leaves', () => {
    setTokens('jwt-1');
    mockFetch.mockResolvedValue(jsonResponse({}));
    useAuth.setState({ user });
    useAuth.getState().logout();
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });

  it('login: starts from a fresh socket (shared review-room workstation)', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ token: 'jwt-2', user }));
    await useAuth.getState().login('a@b.c', 'pw');
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });

  it('setAuth: also closes the previous socket', () => {
    useAuth.getState().setAuth('jwt-3', user);
    expect(getToken()).toBe('jwt-3');
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});

describe('useAuth — session expirée', () => {
  it('unrecoverable 401: purges the session, clears the state and closes the socket', async () => {
    setTokens('jwt-mort');
    useAuth.setState({ user, ready: true });
    // Everything answers 401, token renewal included: the session is dead.
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Not authenticated' }, 401));

    await expect(api.get('/api/projects')).rejects.toThrow(/session/i);
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().ready).toBe(true);
    expect(getToken()).toBeNull();
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});
