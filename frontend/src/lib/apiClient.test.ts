// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, getToken, setSessionExpiredHandler } from './apiClient';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** Nombre d'appels à `/api/auth/refresh` dans le scénario courant. */
const refreshCalls = () => mockFetch.mock.calls.filter(([url]) => url === '/api/auth/refresh').length;

/**
 * Double de serveur : seul `Bearer <valide>` est accepté, tout le reste répond 401.
 * `/api/auth/refresh` répond selon `refresh` — un nouveau jeton, ou un statut d'échec.
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
  it('lit le token depuis localStorage', () => {
    expect(getToken()).toBeNull();
    localStorage.setItem('token', 'abc');
    expect(getToken()).toBe('abc');
  });
});

describe('api', () => {
  it('GET : envoie l’en-tête Authorization quand un token existe', async () => {
    localStorage.setItem('token', 'jwt-123');
    mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
    await api.get('/api/projects');
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/projects');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
  });

  it('GET sans token : pas d’en-tête Authorization', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}));
    await api.get('/api/setup/status');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('POST : sérialise le corps en JSON', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: 1 }));
    const res = await api.post<{ id: number }>('/api/projects', { name: 'P' });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'P' }));
    expect(res.id).toBe(1);
  });

  it('erreur HTTP : lève le message `error` du backend', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Accès refusé' }, 403));
    await expect(api.get('/api/admin/stats')).rejects.toThrow('Accès refusé');
  });

  it('erreur HTTP sans corps JSON : message générique avec le statut', async () => {
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(api.get('/x')).rejects.toThrow('Error 500');
  });

  it('204 No Content : ne tente pas de parser du JSON', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.del('/api/things/1')).resolves.toBeUndefined();
  });
});

describe('api — 401 et renouvellement de session', () => {
  it('401 : renouvelle le jeton puis rejoue la requête', async () => {
    localStorage.setItem('token', 'jwt-vieux');
    localStorage.setItem('refreshToken', 'r-1');
    stubServer('jwt-neuf', { token: 'jwt-neuf' });

    await expect(api.get<{ ok: boolean }>('/api/projects')).resolves.toEqual({ ok: true });
    expect(refreshCalls()).toBe(1);
    expect(localStorage.getItem('token')).toBe('jwt-neuf');
    expect(localStorage.getItem('refreshToken')).toBe('r-new');
    // Trois requêtes : l'originale, le renouvellement, le rejeu.
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('renouvellement refusé : purge la session et prévient une seule fois', async () => {
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

  it('deux requêtes concurrentes ne déclenchent qu’un seul renouvellement', async () => {
    localStorage.setItem('token', 'jwt-vieux');
    localStorage.setItem('refreshToken', 'r-1');
    stubServer('jwt-neuf', { token: 'jwt-neuf' });

    const [a, b] = await Promise.all([api.get('/api/projects'), api.get('/api/shots')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshCalls()).toBe(1);
  });

  it('session absente : un 401 public ne tente aucun renouvellement', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    mockFetch.mockResolvedValue(jsonResponse({ error: 'Not authenticated' }, 401));

    await expect(api.get('/api/client/share/abc')).rejects.toThrow('Not authenticated');
    expect(refreshCalls()).toBe(0);
    expect(expired).not.toHaveBeenCalled();
  });

  it('401 sur /api/auth/login : réponse métier, ni renouvellement ni déconnexion', async () => {
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

  it('renouvellement indisponible (500) : ne déconnecte pas, remonte l’erreur d’origine', async () => {
    localStorage.setItem('token', 'jwt-1');
    localStorage.setItem('refreshToken', 'r-1');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    stubServer('jamais', { status: 503 });

    await expect(api.get('/api/projects')).rejects.toThrow('Not authenticated');
    expect(expired).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBe('jwt-1');
  });

  it('réseau coupé pendant le renouvellement : la session est conservée', async () => {
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
