// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMPTY_SEARCH, MIN_SEARCH_LENGTH, fetchSearch, hasSearchResults } from './searchApi';

/**
 * Client de la recherche globale. Ce qui compte ici : la requête part authentifiée, elle
 * est **annulable** (c'est sa raison d'être), et un jeton expiré ne la fait pas échouer
 * silencieusement — elle repasse par le client partagé, qui sait renouveler la session.
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
  it('encode la saisie dans la query-string', async () => {
    await fetchSearch('SH0120 & co');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=SH0120%20%26%20co');
  });

  it('porte le jeton de session quand il y en a un', async () => {
    localStorage.setItem('token', 'jwt-abc');
    await fetchSearch('v012');
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer jwt-abc');
  });

  it('n’invente pas d’en-tête d’autorisation sans session', async () => {
    await fetchSearch('v012');
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('transmet le signal d’annulation à fetch', async () => {
    const controller = new AbortController();
    await fetchSearch('v012', controller.signal);
    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBe(controller.signal);
  });

  it('laisse remonter l’abandon plutôt que de rendre un résultat vide', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(fetchSearch('v012')).rejects.toThrow('Aborted');
  });

  it('rend les résultats du serveur', async () => {
    expect(await fetchSearch('alpha')).toEqual(results);
  });

  it('repasse par le client partagé sur 401 — le jeton se renouvelle là-bas', async () => {
    localStorage.setItem('token', 'expiré');
    localStorage.setItem('refreshToken', 'refresh-abc');
    fetchMock.mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
    fetchMock.mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
    fetchMock.mockResolvedValueOnce(json({ token: 'neuf' }, 200));
    fetchMock.mockResolvedValueOnce(json(results));
    expect(await fetchSearch('alpha')).toEqual(results);
    expect(localStorage.getItem('token')).toBe('neuf');
  });

  it('lève sur une erreur serveur', async () => {
    fetchMock.mockResolvedValue(json({ error: 'boom' }, 500));
    await expect(fetchSearch('alpha')).rejects.toThrow();
  });
});

describe('hasSearchResults', () => {
  it('reconnaît un résultat vide', () => {
    expect(hasSearchResults(EMPTY_SEARCH)).toBe(false);
  });

  it('suffit d’une seule famille remplie', () => {
    expect(
      hasSearchResults({ ...EMPTY_SEARCH, comments: [], people: [{ id: 1, name: 'ana', jobTitle: null }] }),
    ).toBe(true);
  });

  it('n’interroge pas le serveur sur un seul caractère', () => {
    expect(MIN_SEARCH_LENGTH).toBeGreaterThan(1);
  });
});
