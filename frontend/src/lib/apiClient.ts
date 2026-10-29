// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Small API v2 client (fetch) with a JWT auth header.
 *
 * Tokens are stored in localStorage under the keys `token` (access) and
 * `refreshToken` (renewal). This module is their sole owner.
 *
 * A 401 received while a session exists is not a business error: the access token has
 * expired (7 days) or the session was revoked. The client then tries **once**
 * `/api/auth/refresh`: concurrent requests wait on the same promise, then replay
 * the original request. If the renewal fails, the session is purged and the handler
 * for a dead session (wired by the auth store) brings the user back to sign-in.
 */

import { hasMessage, t, type TParams } from '../v2/i18n';

const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refreshToken';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

/** Records the session tokens (sign-in, 2FA, SSO, renewal). */
export function setTokens(token: string, refreshToken?: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

/** Clears the local session, without any application side effect. */
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Application reaction to a dead session: purges the store and returns to sign-in.
 * Wired by `v2/stores/useAuth`. Going through a handler rather than an import avoids
 * the apiClient ↔ store cycle.
 */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;

export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  onSessionExpired = handler;
}

/**
 * Paths for which a 401 is a business response rather than an expired session. Replaying them makes
 * no sense, and logging out on them would loop: `/api/auth/logout` indeed responds 401
 * when the token is already dead, and it is `logout()` that calls it.
 */
const NO_RETRY_PATHS = ['/api/auth/login', '/api/auth/logout', '/api/auth/refresh', '/api/auth/2fa/verify'];
const isNoRetry = (path: string): boolean => NO_RETRY_PATHS.some((p) => path.startsWith(p));

/** Outcome of a renewal attempt. `unavailable` = server or network failure. */
type RefreshOutcome = 'refreshed' | 'expired' | 'unavailable';

let refreshing: Promise<RefreshOutcome> | null = null;

/** Only one renewal at a time: concurrent requests share the promise. */
function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= runRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function runRefresh(): Promise<RefreshOutcome> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    let res: Response;
    try {
      // A direct `fetch` rather than `request()`: a 401 on the renewal itself must
      // above all not trigger another renewal.
      res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Network down: the session is not proven dead, so we do not log out.
      return 'unavailable';
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { token?: string; refreshToken?: string };
      if (data.token) {
        setTokens(data.token, data.refreshToken);
        return 'refreshed';
      }
    } else if (res.status >= 500) {
      return 'unavailable';
    }
  }
  // Nothing left to renew: the session is dead. Notified only once, since the
  // concurrent callers share this promise.
  clearTokens();
  onSessionExpired?.();
  return 'expired';
}

const send = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

/** Normalized error body produced by `middleware/error` on the backend. */
type ErrorBody = { error?: string; code?: string } & Record<string, unknown>;

/**
 * API error: the message is already in the reader's language, the code remains the
 * stable form of the failure: it is the code a caller must test, never the text.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Error message in the reader's language.
 *
 * The server responds `{ error, code }`: `error` is an **English** trace text, `code`
 * is the stable identifier of the failure (`PROJECT_ARCHIVED`, `CODE_TAKEN`…). The interface
 * is translated into fourteen languages; letting the server's text through means writing in
 * English on a Japanese page, even on the client share, where the reader is not even
 * a studio employee. So we translate by code (`error.<CODE>` in the catalog) and fall back
 * to the English text only for a code absent from the catalog or the response:
 * an untranslated error stays readable; it is never replaced by its key.
 */
export function apiErrorMessage(body: ErrorBody, status: number): string {
  const key = `error.${body.code ?? ''}`;
  if (body.code && hasMessage(key)) return t(key, messageParams(body));
  return body.error ?? t('common.error.http', { status });
}

/**
 * Details attached to the failure: the `details` of an `AppError`, which the error middleware
 * flattens, offered to the translated message as variables.
 *
 * Without them, translating by code erased what the English message said precisely:
 * "ShotGrid refused the credentials: … because the account is locked" became a generic
 * "authentication refused" again, and the reader went back to the server logs.
 * The reason comes from a remote service: it has no translation, but it has its place in
 * the translated sentence.
 */
function messageParams(body: ErrorBody): TParams {
  const params: TParams = {};
  for (const [name, value] of Object.entries(body)) {
    if (name === 'error' || name === 'code') continue;
    if (typeof value === 'string' || typeof value === 'number') params[name] = value;
  }
  return params;
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ErrorBody;
    throw new ApiError(apiErrorMessage(data, res.status), res.status, data.code);
  }
  // Bodiless responses (204 No Content, DELETE…): no JSON to parse.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const sentWith = getToken();
  let res = await send(method, path, body);
  if (res.status === 401 && sentWith !== null && !isNoRetry(path)) {
    // Another call may have renewed the token while the request was in flight: it
    // so replaying the request is enough.
    const outcome = getToken() === sentWith ? await refreshSession() : 'refreshed';
    if (outcome === 'refreshed') res = await send(method, path, body);
    else if (outcome === 'expired')
      throw new ApiError(t('common.error.sessionExpired'), 401, 'SESSION_EXPIRED');
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
