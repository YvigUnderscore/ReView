// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { safeFetch, OutboundBlockedError, OutboundTimeoutError, OutboundTooLargeError } from './safeFetch';

/**
 * `safeFetch` is the backend's only egress point: these tests describe what it refuses (internal address, link-local, name resolving to a private
 * address, redirection inward, endless wait, oversized response) and what it lets through.
 */

const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];

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

describe('safeFetch — refused targets', () => {
  it('refuses a literal private address without sending the request', async () => {
    await expect(safeFetch('http://10.0.0.5/admin')).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses the loopback and the cloud metadata link-local', async () => {
    for (const url of [
      'http://127.0.0.1:9000/review/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:6379/',
    ])
      await expect(safeFetch(url), url).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a public name that resolves to an internal address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    await expect(safeFetch('https://interne.exemple.com/hook')).rejects.toMatchObject({
      code: 'OUTBOUND_BLOCKED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses schemes other than http(s)', async () => {
    for (const url of ['file:///etc/passwd', 'redis://cache:6379', 'gopher://x/'])
      await expect(safeFetch(url), url).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it('refuses an unusable URL', async () => {
    await expect(safeFetch('pas une url')).rejects.toBeInstanceOf(OutboundBlockedError);
  });
});

describe('safeFetch — redirects', () => {
  it('follows no redirect by default', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://ailleurs.exemple.com/'));
    await expect(safeFetch('https://site.exemple.com/x')).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Manual mode is the only one leaving the decision to the calling code.
    expect((fetchMock.mock.calls[0]![1] as RequestInit).redirect).toBe('manual');
  });

  // The heart of the fix: a guard placed BEFORE the request is worth nothing if the target can then return a redirect inward into the network.
  it('rechecks each hop and refuses a redirect to an internal address', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data/'));
    await expect(safeFetch('https://site.exemple.com/x', {}, { maxRedirects: 3 })).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    // The second request was never sent.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to a public target when allowed to', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://cdn.exemple.com/fichier'));
    fetchMock.mockResolvedValueOnce(text('contenu'));
    const res = await safeFetch('https://site.exemple.com/x', {}, { maxRedirects: 3 });
    expect(await res.text()).toBe('contenu');
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://cdn.exemple.com/fichier');
  });

  it('resolves a relative redirect against the current URL', async () => {
    fetchMock.mockResolvedValueOnce(redirect('/ailleurs'));
    fetchMock.mockResolvedValueOnce(text('contenu'));
    await safeFetch('https://site.exemple.com/dossier/x', {}, { maxRedirects: 1 });
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://site.exemple.com/ailleurs');
  });

  it('stops at the permitted number of hops', async () => {
    fetchMock.mockResolvedValue(redirect('https://boucle.exemple.com/'));
    await expect(safeFetch('https://site.exemple.com/x', {}, { maxRedirects: 2 })).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never replays a POST towards a target chosen by the server', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://ailleurs.exemple.com/'));
    await expect(
      safeFetch('https://site.exemple.com/x', { method: 'POST', body: 'secret' }, { maxRedirects: 3 }),
    ).rejects.toMatchObject({ reason: expect.stringContaining('POST') as unknown as string });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('safeFetch — timeout', () => {
  it('gives up if the headers do not arrive', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit).signal!;
          signal.addEventListener('abort', () => reject(signal.reason as Error));
        }),
    );
    await expect(safeFetch('https://lent.exemple.com/', {}, { timeoutMs: 10 })).rejects.toBeInstanceOf(
      OutboundTimeoutError,
    );
  });

  it('lets the body be read once the response is open', async () => {
    // The timer only applies to the headers: a dailies master takes longer to come down than any reasonable delay.
    // à descendre que n'importe quel délai raisonnable.
    fetchMock.mockResolvedValueOnce(text('charge utile'));
    const res = await safeFetch('https://site.exemple.com/', {}, { timeoutMs: 20 });
    await new Promise((r) => setTimeout(r, 40));
    expect(await res.text()).toBe('charge utile');
  });
});

describe('safeFetch — response size', () => {
  it('refuses at once an announced size beyond the ceiling', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('x', { status: 200, headers: { 'content-length': '10000' } }),
    );
    await expect(safeFetch('https://site.exemple.com/', {}, { maxBytes: 100 })).rejects.toBeInstanceOf(
      OutboundTooLargeError,
    );
  });

  it('cuts off a body exceeding the ceiling despite an honest announcement', async () => {
    fetchMock.mockResolvedValueOnce(text('x'.repeat(500)));
    const res = await safeFetch('https://site.exemple.com/', {}, { maxBytes: 100 });
    await expect(res.text()).rejects.toBeInstanceOf(OutboundTooLargeError);
  });

  it('lets through a response under the ceiling', async () => {
    fetchMock.mockResolvedValueOnce(text('court'));
    const res = await safeFetch('https://site.exemple.com/', {}, { maxBytes: 1000 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('court');
  });
});

describe('safeFetch — passing cases', () => {
  it('sends to a public target and returns the response as-is', async () => {
    fetchMock.mockResolvedValueOnce(text('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
    const res = await safeFetch('https://hooks.slack.com/services/x', { method: 'POST', body: '{}' });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
  });

  // The only escape hatch: the development simulator lives on a private address.
  it('exempts the explicitly allowed hosts, without resolving the name', async () => {
    const res = await safeFetch(
      'http://host.docker.internal:8890/api/v1.1/',
      {},
      { allowHosts: ['HOST.DOCKER.INTERNAL:8890'] },
    );
    expect(res.status).toBe(200);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not extend the exemption to another port of the same host', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '192.168.65.2', family: 4 }] as never);
    await expect(
      safeFetch('http://host.docker.internal:9000/', {}, { allowHosts: ['host.docker.internal:8890'] }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
  });

  it('refuses a forbidden scheme even for an exempted host', async () => {
    await expect(safeFetch('file:///etc/passwd', {}, { allowHosts: [''] })).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
  });
});
