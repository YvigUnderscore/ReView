// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMPTY_SEARCH, MIN_SEARCH_LENGTH, fetchSearch, hasSearchResults } from './searchApi';

/**
 * Client of the global search. What matters here: the request goes out authenticated, it is
 * **cancellable** (that is its whole purpose), and an expired token does not make it fail silently —
 * it goes back through the shared client, which knows how to renew the session.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const results = { ...EMPTY_SEARCH, projects: [{ id: 1, name: 'Alpha' }] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn().mockResolvedValue(json(results));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('fetchSearch', () => {
  it('encodes the input in the query string', async () => {
    await fetchSearch('SH0120 & co');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=SH0120%20%26%20co');
  });

  it('carries the session token when there is one', async () => {
    localStorage.setItem('token', 'jwt-abc');
    await fetchSearch('v012');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt-abc');
  });

  it('does not invent an authorization header without a session', async () => {
    await fetchSearch('v012');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('passes the cancellation signal on to fetch', async () => {
    const controller = new AbortController();
    await fetchSearch('v012', controller.signal);
    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBe(controller.signal);
  });

  it('lets the abort propagate rather than returning an empty result', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(fetchSearch('v012')).rejects.toThrow('Aborted');
  });

  it('returns the server results', async () => {
    expect(await fetchSearch('alpha')).toEqual(results);
  });

  it('goes back through the shared client on 401 — the token is renewed there', async () => {
    localStorage.setItem('token', 'expiré');
    localStorage.setItem('refreshToken', 'refresh-abc');
    fetchMock.mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
    fetchMock.mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
    fetchMock.mockResolvedValueOnce(json({ token: 'neuf' }, 200));
    fetchMock.mockResolvedValueOnce(json(results));
    expect(await fetchSearch('alpha')).toEqual(results);
    expect(localStorage.getItem('token')).toBe('neuf');
  });

  it('throws on a server error', async () => {
    fetchMock.mockResolvedValue(json({ error: 'boom' }, 500));
    await expect(fetchSearch('alpha')).rejects.toThrow();
  });
});

describe('hasSearchResults', () => {
  it('recognises an empty result', () => {
    expect(hasSearchResults(EMPTY_SEARCH)).toBe(false);
  });

  it('one filled family is enough', () => {
    expect(
      hasSearchResults({ ...EMPTY_SEARCH, comments: [], people: [{ id: 1, name: 'ana', jobTitle: null }] }),
    ).toBe(true);
  });

  it('does not query the server for a single character', () => {
    expect(MIN_SEARCH_LENGTH).toBeGreaterThan(1);
  });
});
