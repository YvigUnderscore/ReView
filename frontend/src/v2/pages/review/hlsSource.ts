// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * HLS loading rules (wave 2: segments no longer go through the API).
 *
 * Since the sub-playlist points to presigned MinIO URLs, the requests of a single player no longer
 * all go to the same place: the manifests to the API (`/api/…`), the segments to the storage. Two
 * consequences, isolated here so that they can be tested without a browser.
 */

/** hls.js error fragment, as far as needed here: avoids depending on the player's types. */
export interface HlsErrorLike {
  details?: string;
  response?: { code?: number };
}

/**
 * An API URL: same origin as the application, and a path under `/api/`.
 *
 * ⚠ Comparing the start of the string is not enough: `loadSource('/api/…')` is normalized by hls.js
 * against `location.href` before any network call, so `xhrSetup` receives ABSOLUTE URLs. A test on
 * `startsWith('/api/')` would let the manifest go out without a token (immediate 401). In production,
 * storage is served from the same origin as the application (`https://domain/<bucket>/…`): it is the
 * PATH that tells them apart.
 */
export function isApiUrl(url: string, base: string = window.location.href): boolean {
  try {
    const target = new URL(url, base);
    return target.origin === new URL(base).origin && target.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Sets the session token, and **only** on the API.
 *
 * Sending it to a segment's presigned URL would deliver it to the storage (its logs, and another origin
 * in development) without authorizing anything: the S3 signature is enough, and S3 moreover refuses two
 * competing authentication mechanisms.
 */
export function applyHlsAuth(xhr: XMLHttpRequest, url: string, token: string | null, base?: string): void {
  if (token && isApiUrl(url, base ?? window.location.href))
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
}

/**
 * A presigned URL has an end of validity. Past this delay (a dailies session longer than the token's
 * lifetime), the segment answers 401/403: the playlist in hand is stale and must be requested again.
 * The manifest, for its part, is always accessible.
 */
export function isExpiredMediaUrlError(data: HlsErrorLike): boolean {
  const code = data.response?.code;
  return data.details === 'fragLoadError' && (code === 401 || code === 403);
}

/**
 * Safeguard: if the reload fixes nothing (access really revoked during playback), we stop insisting
 * rather than looping on the manifest.
 */
export const MAX_HLS_REFRESHES = 3;
