// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api, getToken } from '@/lib/apiClient';

/**
 * Authenticated `fetch` for the API calls `api.*` cannot express: a file to download (blob, text,
 * response headers), a request to abort (`signal`), an error body to read beyond its message.
 *
 * Those calls used to build their own `Authorization` header and stopped there: once the access
 * token expired they failed with a 401 — or logged the reader out — where every `api.*` call
 * renews the session and replays. Here the renewal stays `apiClient`'s: on a 401 with a token sent,
 * a cheap `api.get('/api/auth/me')` goes through its refresh (or ends the session the usual way,
 * throwing `SESSION_EXPIRED`), then the request is replayed once with the fresh token.
 *
 * Not for presigned storage URLs: those carry their own signature and must not receive the token.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const sentWith = getToken();
  const res = await fetch(path, withAuth(init, sentWith));
  if (res.status !== 401 || sentWith === null) return res;
  if (getToken() === sentWith) await api.get('/api/auth/me');
  return fetch(path, withAuth(init, getToken()));
}

function withAuth(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}
