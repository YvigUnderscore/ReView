// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, getToken, setSessionExpiredHandler } from './apiClient';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** Number of calls to `/api/auth/refresh` in the current scenario. */
const refreshCalls = () => mockFetch.mock.calls.filter(([url]) => url === '/api/auth/refresh').length;

/**
 * Server double: only `Bearer <valid>` is accepted, everything else responds 401.
 * `/api/auth/refresh` responds according to `refresh`: a new token, or a failure status.
 */
function stubServer(valid: string, refresh: { token?: string; status?: number } = {}) {
  mockFetch.mockImplementation((url: string, init: RequestInit) => {
    if (url === '/api/auth/refresh') {
      if (refresh.token)
        return Promise.resolve(jsonResponse({ token: refresh.token, refreshToken: 'r-new' }));
      return Promise.resolve(jsonResponse({ error: 'Refresh token invalide' }, refresh.status ?? 401));
    }
    const auth = (init.headers as Record<string, string>).Authorization;
    return auth === `Bearer ${valid}`
      ? Promise.resolve(jsonResponse({ ok: true }))
      : Promise.resolve(jsonResponse({ error: 'Not authenticated' }, 401));
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  setSessionExpiredHandler(null);
});

describe('getToken', () => {
  it('reads the token from localStorage', () => {
    expect(getToken()).toBeNull();
    localStorage.setItem('token', 'abc');
    expect(getToken()).toBe('abc');
  });
});

describe('api', () => {
  it('GET: sends the Authorization header when a token exists', async () => {
    localStorage.setItem('token', 'jwt-123');
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await api.get('/api/projects');
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/projects');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
  });

  it('GET without token: no Authorization header', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await api.get('/api/setup/status');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('POST: serializes the body as JSON', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 1 }));
    const res = await api.post<{ id: number }>('/api/projects', { name: 'P' });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'P' }));
    expect(res.id).toBe(1);
  });

  it('HTTP error: throws the backend `error` message', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Accès refusé' }, 403));
    await expect(api.get('/api/admin/stats')).rejects.toThrow('Accès refusé');
  });

  it('HTTP error without JSON body: generic message with the status', async () => {
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(api.get('/x')).rejects.toThrow('Error 500');
  });

  it('204 No Content: does not try to parse JSON', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.del('/api/things/1')).resolves.toBeUndefined();
  });
});

describe('api — 401 and session renewal', () => {
  it('401: renews the token then replays the request', async () => {
    localStorage.setItem('token', 'jwt-vieux');
    localStorage.setItem('refreshToken', 'r-1');
    stubServer('jwt-neuf', { token: 'jwt-neuf' });

    await expect(api.get<{ ok: boolean }>('/api/projects')).resolves.toEqual({ ok: true });
    expect(refreshCalls()).toBe(1);
    expect(localStorage.getItem('token')).toBe('jwt-neuf');
    expect(localStorage.getItem('refreshToken')).toBe('r-new');
    // Three requests: the original, the renewal, and the replay.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('renewal refused: purges the session and notifies only once', async () => {
    localStorage.setItem('token', 'jwt-mort');
    localStorage.setItem('refreshToken', 'r-mort');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    stubServer('jamais');

    await expect(api.get('/api/projects')).rejects.toThrow(/session/i);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('two concurrent requests trigger only one renewal', async () => {
    localStorage.setItem('token', 'jwt-vieux');
    localStorage.setItem('refreshToken', 'r-1');
    stubServer('jwt-neuf', { token: 'jwt-neuf' });

    const [a, b] = await Promise.all([api.get('/api/projects'), api.get('/api/shots')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshCalls()).toBe(1);
  });

  it('no session: a public 401 attempts no renewal', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Not authenticated' }, 401));

    await expect(api.get('/api/client/share/abc')).rejects.toThrow('Not authenticated');
    expect(refreshCalls()).toBe(0);
    expect(expired).not.toHaveBeenCalled();
  });

  it('401 on /api/auth/login: business response, neither renewal nor logout', async () => {
    localStorage.setItem('token', 'jwt-1');
    localStorage.setItem('refreshToken', 'r-1');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Identifiants invalides' }, 401));

    await expect(api.post('/api/auth/login', { email: 'a@b.c' })).rejects.toThrow('Identifiants invalides');
    expect(refreshCalls()).toBe(0);
    expect(expired).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBe('jwt-1');
  });

  it('renewal unavailable (500): does not log out, surfaces the original error', async () => {
    localStorage.setItem('token', 'jwt-1');
    localStorage.setItem('refreshToken', 'r-1');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    stubServer('jamais', { status: 503 });

    await expect(api.get('/api/projects')).rejects.toThrow('Not authenticated');
    expect(expired).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBe('jwt-1');
  });

  it('network lost during renewal: the session is kept', async () => {
    localStorage.setItem('token', 'jwt-1');
    localStorage.setItem('refreshToken', 'r-1');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    mockFetch.mockImplementation((url: string) =>
      url === '/api/auth/refresh'
        ? Promise.reject(new Error('Failed to fetch'))
        : Promise.resolve(jsonResponse({ error: 'Not authenticated' }, 401)),
    );

    await expect(api.get('/api/projects')).rejects.toThrow('Not authenticated');
    expect(expired).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBe('jwt-1');
  });
});
