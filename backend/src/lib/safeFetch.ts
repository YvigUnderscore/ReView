// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppError } from './errors';
import { assertPublicHttpTarget } from './ssrfGuard';

/**
 * PROJECT RULE — no bare `fetch` in `backend/src`.
 *
 * Every outgoing request leaves a process (API or worker) located INSIDE the application network, where MinIO, Redis, Postgres, Grafana and — on a
 * cloud host — the metadata service on 169.254.169.254 answer without network authentication. A URL that comes from elsewhere (admin input, a
 * browser subscription, the response of a remote site) must therefore never be passed as-is to `fetch`: it would amount to the ability to send
 * arbitrary requests from this network.
 *
 * `safeFetch` brings together the four protections that must go together:
 *
 * 1. **SSRF guard on the resolved address** (`assertPublicHttpTarget`): http(s) scheme only, and refusal of any name of which ONE of the addresses
 *    falls into an internal range.
 * 2. **Redirects never blindly followed**: `redirect: 'manual'`. A redirect is a second request to a target nobody has checked — it is the classic
 *    bypass of a check made before the call. When `maxRedirects > 0`, each hop is re-submitted to the guard, and only safe methods (GET/HEAD) are replayed.
 * 3. **Timeout** on the arrival of the HEADERS. It is deliberately lifted once the response is open: a dailies master takes more than thirty seconds to
 *    come down, and cutting it mid-stream would break the ShotGrid synchronisation.
 * 4. **Bounded response size** (`maxBytes`): announced `Content-Length` AND bytes actually read, so that a remote server cannot inflate the memory of a worker.
 *
 * `allowHosts` is the only escape hatch — it exists for the development ShotGrid simulator (`SHOTGRID_INSECURE_HOSTS`), which lives precisely on a private address.
 */

/** Default timeout for response headers. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Codes describing a redirect; `fetch` does not follow them in `manual` mode. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Statuses whose body is necessarily empty: `new Response` refuses them with a body. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

export interface SafeFetchOptions {
  /** Header timeout, in milliseconds (default: 15 s). */
  timeoutMs?: number;
  /** Redirects followed, each rechecked by the guard (default: 0 = none). */
  maxRedirects?: number;
  /** Byte ceiling of the response body; absent = no ceiling (media stream). */
  maxBytes?: number;
  /** Hosts (`hostname:port`) exempted from the guard — development simulator only. */
  allowHosts?: Iterable<string>;
}

/** Target refused before even sending: internal address, forbidden scheme, redirect not followed. */
export class OutboundBlockedError extends AppError {
  constructor(
    readonly target: string,
    readonly reason: string,
  ) {
    super(`Outbound request refused: ${reason}`, 502, 'OUTBOUND_BLOCKED');
    this.name = 'OutboundBlockedError';
  }
}

/** The response headers did not arrive within the allotted time. */
export class OutboundTimeoutError extends AppError {
  constructor(
    readonly target: string,
    readonly timeoutMs: number,
  ) {
    super(`Outbound request timed out after ${timeoutMs} ms`, 504, 'OUTBOUND_TIMEOUT');
    this.name = 'OutboundTimeoutError';
  }
}

/** The response exceeds the accepted byte ceiling. */
export class OutboundTooLargeError extends AppError {
  constructor(
    readonly target: string,
    readonly maxBytes: number,
  ) {
    super(`Outbound response exceeds ${maxBytes} bytes`, 502, 'OUTBOUND_TOO_LARGE');
    this.name = 'OutboundTooLargeError';
  }
}

function normalizeHosts(hosts?: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of hosts ?? []) {
    const host = raw.trim().toLowerCase();
    if (host) out.add(host);
  }
  return out;
}

function toUrl(input: string | URL): URL {
  try {
    return input instanceof URL ? input : new URL(input);
  } catch {
    throw new OutboundBlockedError(String(input), 'invalid URL');
  }
}

/**
 * Acceptable target? The scheme is checked even for an exempted host: `file://` or `redis://` never have any reason to be here.
 */
export async function assertOutboundTarget(url: URL, allowHosts?: Iterable<string>): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new OutboundBlockedError(url.href, `scheme not allowed (${url.protocol.replace(':', '')})`);
  if (normalizeHosts(allowHosts).has(url.host.toLowerCase())) return;
  const verdict = await assertPublicHttpTarget(url.href);
  if (!verdict.ok) throw new OutboundBlockedError(url.href, verdict.reason);
}

/**
 * One request, a timeout on the headers. The timer is disarmed as soon as the response opens: the body can then be read for as long as it takes.
 */
async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new OutboundTimeoutError(url, timeoutMs)), timeoutMs);
  const upstream = init.signal ?? undefined;
  const relay = () => controller.abort(upstream?.reason);
  if (upstream) {
    if (upstream.aborted) relay();
    else upstream.addEventListener('abort', relay, { once: true });
  }
  try {
    return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener('abort', relay);
  }
}

/**
 * Response repackaged behind a byte counter. The announced size is checked first (immediate refusal, without downloading anything), then the real size —
 * a hostile server is not bound to tell the truth in its `Content-Length`.
 */
function limitResponseBody(res: Response, maxBytes: number, target: string): Response {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel().catch(() => undefined);
    throw new OutboundTooLargeError(target, maxBytes);
  }
  if (!res.body || NULL_BODY_STATUS.has(res.status)) return res;

  let seen = 0;
  const limited = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(new OutboundTooLargeError(target, maxBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(limited, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * Hardened `fetch`: SSRF guard at each hop, controlled redirects, timeout and bounded response size. See the file header for the rule and its reasons.
 */
export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxRedirects = 0, maxBytes, allowHosts } = options;
  const method = (init.method ?? 'GET').toUpperCase();
  let current = toUrl(input);

  for (let hop = 0; ; hop += 1) {
    await assertOutboundTarget(current, allowHosts);
    const res = await fetchOnce(current.href, init, timeoutMs);
    if (!REDIRECT_STATUS.has(res.status))
      return maxBytes === undefined ? res : limitResponseBody(res, maxBytes, current.href);

    // Redirect: the body is of no interest to us, and leaving it open would hold the socket.
    await res.body?.cancel().catch(() => undefined);
    if (hop >= maxRedirects)
      throw new OutboundBlockedError(current.href, `redirect not followed (HTTP ${res.status})`);
    // Replaying a POST/PUT towards an address chosen by the server amounts to handing it the payload: only safe methods are followed.
    if (method !== 'GET' && method !== 'HEAD')
      throw new OutboundBlockedError(current.href, `redirect on a ${method} request is not followed`);
    const location = res.headers.get('location');
    if (!location) throw new OutboundBlockedError(current.href, 'redirect without a Location header');
    try {
      current = new URL(location, current);
    } catch {
      throw new OutboundBlockedError(current.href, 'redirect to an unusable location');
    }
  }
}
