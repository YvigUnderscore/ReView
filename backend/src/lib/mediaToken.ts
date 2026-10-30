// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt, { type VerifyOptions } from 'jsonwebtoken';
import { env } from '../config/env';

/**
 * Media playback token (wave 2 — HLS broadcast outside the web process).
 *
 * The master manifest `/api/media/:id/hls/master.m3u8` is the ONLY point where authorisation is checked against the
 * database (media published or in draft by its uploader + project membership). It issues this token, which the
 * sub-playlists carry in their query: the next request costs an HMAC check and zero PostgreSQL round trips. The
 * segments no longer go through Node at all (MinIO presigned URLs written into the sub-playlist).
 *
 * Three properties hold the safety of the scheme, all covered by the tests:
 *  1. **Scope** — the token names the media AND the user; it opens nothing else.
 *  2. **Duration** — it expires (`HLS_PLAYBACK_TTL_SEC`), like the presigned URLs it allows obtaining; the player
 *     reloads the manifest when they go stale.
 *  3. **Isolation** — it carries `kind: 'media-playback'`, and `middleware/auth` only accepts as an access token a
 *     payload WITHOUT `kind`: this token can therefore never authenticate an API request, nor can an access token
 *     authorise playback here.
 */

/**
 * Token lifetime — aligned with that of the presigned segment URLs.
 *
 * This token names its holder (`uid`), but only at opening: like the URLs it allows obtaining, it is not re-checked
 * against the database once issued. An access revocation therefore only bites after these two hours — the same delay
 * as `HLS_URL_TTL_SEC`, and for the same reason. It is the right place to hook a per-request check the day we want to
 * close A3-05: it already carries the scope (media + player), it only lacks re-reading the media's state at each call.
 */
export const HLS_PLAYBACK_TTL_SEC = 2 * 60 * 60;

const PLAYBACK_KIND = 'media-playback';

// Same rule as lib/jwt: the algorithm is fixed on both sides, never read from the header of the presented token.
const ALGORITHM = 'HS256' as const;
const VERIFY_OPTIONS: VerifyOptions = { algorithms: [ALGORITHM] };

interface PlaybackClaims {
  kind?: string;
  mediaId?: number;
  uid?: number;
}

/** Playback token for this media and this user. */
export function signMediaPlaybackToken(
  mediaId: number,
  userId: number,
  ttlSeconds: number = HLS_PLAYBACK_TTL_SEC,
): string {
  return jwt.sign({ kind: PLAYBACK_KIND, mediaId, uid: userId }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: ttlSeconds,
  });
}

/** True if `token` is a valid, unexpired playback token, for THIS media and THIS player. */
export function verifyMediaPlaybackToken(
  token: string | undefined | null,
  mediaId: number,
  userId: number,
): boolean {
  if (!token) return false;
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, VERIFY_OPTIONS) as PlaybackClaims;
    return claims.kind === PLAYBACK_KIND && claims.mediaId === mediaId && claims.uid === userId;
  } catch {
    return false;
  }
}
