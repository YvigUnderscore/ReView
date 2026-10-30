// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => {
  const state: { token: string | null; me: ReturnType<typeof vi.fn<(path: string) => Promise<unknown>>> } = {
    token: 'old',
    me: vi.fn<(path: string) => Promise<unknown>>(),
  };
  return state;
});
vi.mock('@/lib/apiClient', () => ({
  getToken: () => session.token,
  api: { get: (path: string) => session.me(path) },
}));

import { apiFetch } from './apiFetch';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const auth = (call: number) => new Headers(fetchMock.mock.calls[call][1]?.headers).get('Authorization');

afterEach(() => {
  fetchMock.mockReset();
  session.me.mockReset();
  session.token = 'old';
});

describe('apiFetch', () => {
  it('sends the session token and passes the response through', async () => {
    fetchMock.mockResolvedValue(new Response('csv', { status: 200 }));
    const controller = new AbortController();
    const res = await apiFetch('/api/x', { signal: controller.signal, headers: { Accept: 'text/csv' } });
    expect(await res.text()).toBe('csv');
    expect(auth(0)).toBe('Bearer old');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Accept')).toBe('text/csv');
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('renews the session through apiClient on a 401, then replays with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    session.me.mockImplementation(() => {
      session.token = 'new';
      return Promise.resolve({ user: {} });
    });
    const res = await apiFetch('/api/x');
    expect(res.status).toBe(200);
    expect(session.me).toHaveBeenCalledWith('/api/auth/me');
    expect(auth(1)).toBe('Bearer new');
  });

  it('does not renew again when another call already did', async () => {
    fetchMock.mockImplementationOnce(() => {
      session.token = 'renewed-meanwhile';
      return Promise.resolve(new Response(null, { status: 401 }));
    });
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await apiFetch('/api/x');
    expect(session.me).not.toHaveBeenCalled();
    expect(auth(1)).toBe('Bearer renewed-meanwhile');
  });

  it('propagates the end of the session', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    session.me.mockRejectedValue(new Error('Session expired'));
    await expect(apiFetch('/api/x')).rejects.toThrow('Session expired');
  });

  it('leaves a 401 alone when signed out', async () => {
    session.token = null;
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await apiFetch('/api/x')).status).toBe(401);
    expect(auth(0)).toBeNull();
    expect(session.me).not.toHaveBeenCalled();
  });
});
