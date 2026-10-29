// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  assertOutboundTarget,
  OutboundBlockedError,
  OutboundTimeoutError,
  OutboundTooLargeError,
} from './safeFetch';
import { ignoreFailure } from './ignoreFailure';

/**
 * Hardened egress **with a host allow-list re-evaluated at every hop**.
 *
 * `safeFetch` is the backend's ordinary egress door: it checks the ADDRESS resolved at each hop (anti-SSRF), and
 * bounds the delay and the size. It does not know the application-level allow-lists though — the OCIO assets one,
 * for example, which only accepts `github.com` and GitHub's content hosts. Yet GitHub serves its assets precisely
 * through a 302 redirect, and an allow-list checked once on the starting URL says nothing about the target actually
 * reached: that is the classic bypass. The redirect must therefore be followed *and* re-submitted to the allow-list.
 *
 * Hence this module, the second — and last — place of the backend that calls `fetch` directly. Each hop goes through
 * both guards, in this order:
 *
 * 1. `assertOutboundTarget`: http(s) scheme and refusal of any internal address (loopback, RFC 1918, link-local
 *    169.254.169.254 cloud metadata);
 * 2. `isAllowedHost`: the caller's allow-list, on the host of THIS hop.
 *
 * Added to this: the timeout on the arrival of headers (disarmed afterwards, as in `safeFetch`: a download may last)
 * and the refusal to replay an unsafe method towards a target chosen by the remote server.
 *
 * `readCappedBody` completes the picture on the read side: an announced `Content-Length` only binds whoever believes
 * it, so the bytes actually received are counted as well.
 */

/** Default timeout for response headers. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Redirect status codes; `fetch` does not follow them in `manual` mode. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export interface AllowlistedFetchOptions {
  /** Application-level allow-list, re-evaluated at every hop. Returning `false` refuses the target. */
  isAllowedHost: (url: URL) => boolean;
  /** Header timeout in milliseconds (default: 15 s). */
  timeoutMs?: number;
  /** Redirects followed, each re-submitted to both guards (default: 3). */
  maxRedirects?: number;
}

function toUrl(input: string | URL): URL {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    throw new OutboundBlockedError(String(input), 'invalid URL');
  }
}

/**
 * One request, a timeout on the headers. The timer is disarmed as soon as the response opens: the body is then read
 * for as long as it takes (a 25 MB ACES config behind a slow link remains legitimate).
 */
async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new OutboundTimeoutError(url, timeoutMs)), timeoutMs);
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hardened `fetch` whose every hop — the starting one included — must satisfy the SSRF guard AND the caller's
 * allow-list. See the file header for the why.
 */
export async function fetchAllowlisted(
  input: string | URL,
  init: RequestInit = {},
  options: AllowlistedFetchOptions,
): Promise<Response> {
  const { isAllowedHost, timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = 3 } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  let current = toUrl(input);

  for (let hop = 0; ; hop += 1) {
    await assertOutboundTarget(current);
    if (!isAllowedHost(current)) throw new OutboundBlockedError(current.href, 'host is not allow-listed');

    const res = await fetchOnce(current.href, init, timeoutMs);
    if (!REDIRECT_STATUS.has(res.status)) return res;

    // A redirect body is of no interest, and leaving it open would hold the socket until garbage collection.
    await res.body?.cancel().catch(ignoreFailure('response body cancel failed'));
    if (hop >= maxRedirects)
      // Deliberately plain patterns: they surface as a 502, they are not displayed.
      throw new OutboundBlockedError(current.href, 'redirect-limit-exceeded');
    if (method !== 'GET' && method !== 'HEAD')
      throw new OutboundBlockedError(current.href, 'redirect-on-unsafe-method');
    const location = res.headers.get('location');
    if (!location) throw new OutboundBlockedError(current.href, 'redirect without a Location header');
    try {
      current = new URL(location, current);
    } catch {
      throw new OutboundBlockedError(current.href, 'redirect to an unusable location');
    }
  }
}

/**
 * Reads a response body into memory under a byte ceiling. The announced `Content-Length` is refused outright if it
 * exceeds it — then the bytes received are counted, because a hostile server is not bound to tell the truth in its headers.
 */
export async function readCappedBody(res: Response, maxBytes: number, target = res.url): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(ignoreFailure('response body cancel failed'));
    throw new OutboundTooLargeError(target, maxBytes);
  }
  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      await reader.cancel().catch(ignoreFailure('response body cancel failed'));
      throw new OutboundTooLargeError(target, maxBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
