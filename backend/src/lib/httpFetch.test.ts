// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { fetchAllowlisted, readCappedBody } from './httpFetch';
import { OutboundBlockedError, OutboundTimeoutError, OutboundTooLargeError } from './safeFetch';

/**
 * `fetchAllowlisted` existe pour une seule raison : une allow-list d'hôtes contrôlée une
 * fois sur l'URL de départ ne dit rien de la cible réellement atteinte. Ces tests décrivent
 * donc surtout ce qui se passe APRÈS une redirection.
 */

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];
const ALLOWED = new Set(['github.com', 'objects.githubusercontent.com']);
const allowList = { isAllowedHost: (url: URL) => ALLOWED.has(url.hostname) };

const text = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue(PUBLIC_ADDRESS as never);
  fetchMock = vi.fn<typeof fetch>();
  fetchMock.mockResolvedValue(text('ok'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('fetchAllowlisted — allow-list au départ', () => {
  it('sert un hôte allowlisté', async () => {
    const res = await fetchAllowlisted('https://github.com/a/b', {}, allowList);
    await expect(res.text()).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuse un hôte hors allow-list sans émettre la requête', async () => {
    await expect(fetchAllowlisted('https://evil.test/x', {}, allowList)).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse une adresse interne même si l'allow-list dit oui", async () => {
    await expect(
      fetchAllowlisted('http://169.254.169.254/latest/meta-data/', {}, { isAllowedHost: () => true }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchAllowlisted — allow-list ré-évaluée à CHAQUE saut', () => {
  it('suit une redirection vers un hôte allowlisté', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://objects.githubusercontent.com/asset'))
      .mockResolvedValueOnce(text('config'));
    const res = await fetchAllowlisted('https://github.com/a/b', {}, allowList);
    await expect(res.text()).resolves.toBe('config');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuse une redirection vers un hôte hors allow-list', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://evil.test/collect'));
    await expect(fetchAllowlisted('https://github.com/a/b', {}, allowList)).rejects.toMatchObject({
      code: 'OUTBOUND_BLOCKED',
    });
    // Le second saut n'a jamais été émis.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuse une redirection vers les métadonnées cloud (le scénario A2-03)', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data/iam/'));
    await expect(
      fetchAllowlisted('https://github.com/a/b', {}, { isAllowedHost: () => true }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuse une redirection vers un nom public qui résout en interne', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://github.com/etape-2'));
    vi.mocked(lookup)
      .mockResolvedValueOnce(PUBLIC_ADDRESS as never)
      .mockResolvedValueOnce([{ address: '10.0.0.7', family: 4 }] as never);
    await expect(fetchAllowlisted('https://github.com/a/b', {}, allowList)).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('borne le nombre de sauts', async () => {
    fetchMock.mockResolvedValue(redirect('https://github.com/encore'));
    await expect(
      fetchAllowlisted('https://github.com/a/b', {}, { ...allowList, maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuse une redirection sans en-tête Location', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(fetchAllowlisted('https://github.com/a/b', {}, allowList)).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
  });

  it('ne rejoue jamais une méthode non sûre vers une cible choisie par le serveur', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://github.com/ailleurs', 307));
    await expect(
      fetchAllowlisted('https://github.com/a/b', { method: 'POST', body: 'x' }, allowList),
    ).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('fetchAllowlisted — délai d’attente', () => {
  it('abandonne si les en-têtes ne viennent pas', async () => {
    fetchMock.mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal!;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true });
      });
    });
    await expect(
      fetchAllowlisted('https://github.com/lent', {}, { ...allowList, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(OutboundTimeoutError);
  });
});

describe('readCappedBody', () => {
  it('rend le corps sous le plafond', async () => {
    await expect(readCappedBody(text('bonjour'), 1024)).resolves.toEqual(Buffer.from('bonjour'));
  });

  it('refuse sur le Content-Length annoncé, sans rien télécharger', async () => {
    const res = text('court', { headers: { 'content-length': '99999' } });
    await expect(readCappedBody(res, 10)).rejects.toBeInstanceOf(OutboundTooLargeError);
  });

  it('refuse aussi un amont qui ment sur sa taille', async () => {
    const res = text('x'.repeat(5000), { headers: { 'content-length': '5' } });
    await expect(readCappedBody(res, 100)).rejects.toBeInstanceOf(OutboundTooLargeError);
  });

  it('tolère une réponse sans corps', async () => {
    await expect(readCappedBody(new Response(null, { status: 204 }), 10)).resolves.toEqual(Buffer.alloc(0));
  });
});
