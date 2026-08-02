// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, getToken } from './apiClient';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
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
    await expect(api.get('/x')).rejects.toThrow('Erreur 500');
  });

  it('204 No Content : ne tente pas de parser du JSON', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.del('/api/things/1')).resolves.toBeUndefined();
  });
});
