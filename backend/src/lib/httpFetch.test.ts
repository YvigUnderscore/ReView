// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

import { lookup } from 'node:dns/promises';
import { fetchAllowlisted, readCappedBody } from './httpFetch';
import { OutboundBlockedError, OutboundTimeoutError, OutboundTooLargeError } from './safeFetch';

/**
 * `fetchAllowlisted` exists for one reason: a host allow-list checked once on the starting URL says nothing about the
 * target actually reached. These tests therefore mostly describe what happens AFTER a redirect.
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

describe('fetchAllowlisted — allow-list at the start', () => {
  it('serves an allow-listed host', async () => {
    const res = await fetchAllowlisted('https://github.com/a/b', {}, allowList);
    await expect(res.text()).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses a host outside the allow-list without sending the request', async () => {
    await expect(fetchAllowlisted('https://evil.test/x', {}, allowList)).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an internal address even if the allow-list says yes', async () => {
    await expect(
      fetchAllowlisted('http://169.254.169.254/latest/meta-data/', {}, { isAllowedHost: () => true }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchAllowlisted — allow-list re-evaluated at EVERY hop', () => {
  it('follows a redirect to an allow-listed host', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://objects.githubusercontent.com/asset'))
      .mockResolvedValueOnce(text('config'));
    const res = await fetchAllowlisted('https://github.com/a/b', {}, allowList);
    await expect(res.text()).resolves.toBe('config');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect to a host outside the allow-list', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://evil.test/collect'));
    await expect(fetchAllowlisted('https://github.com/a/b', {}, allowList)).rejects.toMatchObject({
      code: 'OUTBOUND_BLOCKED',
    });
    // The second hop was never sent.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses a redirect to cloud metadata (the A2-03 scenario)', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://169.254.169.254/latest/meta-data/iam/'));
    await expect(
      fetchAllowlisted('https://github.com/a/b', {}, { isAllowedHost: () => true }),
    ).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses a redirect to a public name that resolves internally', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://github.com/etape-2'));
    vi.mocked(lookup)
      .mockResolvedValueOnce(PUBLIC_ADDRESS as never)
      .mockResolvedValueOnce([{ address: '10.0.0.7', family: 4 }] as never);
    await expect(fetchAllowlisted('https://github.com/a/b', {}, allowList)).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('bounds the number of hops', async () => {
    fetchMock.mockResolvedValue(redirect('https://github.com/encore'));
    await expect(
      fetchAllowlisted('https://github.com/a/b', {}, { ...allowList, maxRedirects: 2 }),
    ).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuses a redirect without a Location header', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(fetchAllowlisted('https://github.com/a/b', {}, allowList)).rejects.toBeInstanceOf(
      OutboundBlockedError,
    );
  });

  it('never replays an unsafe method towards a target chosen by the server', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://github.com/ailleurs', 307));
    await expect(
      fetchAllowlisted('https://github.com/a/b', { method: 'POST', body: 'x' }, allowList),
    ).rejects.toMatchObject({ code: 'OUTBOUND_BLOCKED' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('fetchAllowlisted — timeout', () => {
  it('gives up if the headers do not come', async () => {
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
  it('returns the body under the ceiling', async () => {
    await expect(readCappedBody(text('bonjour'), 1024)).resolves.toEqual(Buffer.from('bonjour'));
  });

  it('refuses on the announced Content-Length, without downloading anything', async () => {
    const res = text('court', { headers: { 'content-length': '99999' } });
    await expect(readCappedBody(res, 10)).rejects.toBeInstanceOf(OutboundTooLargeError);
  });

  it('also refuses an upstream that lies about its size', async () => {
    const res = text('x'.repeat(5000), { headers: { 'content-length': '5' } });
    await expect(readCappedBody(res, 100)).rejects.toBeInstanceOf(OutboundTooLargeError);
  });

  it('tolerates a response without a body', async () => {
    await expect(readCappedBody(new Response(null, { status: 204 }), 10)).resolves.toEqual(Buffer.alloc(0));
  });
});
