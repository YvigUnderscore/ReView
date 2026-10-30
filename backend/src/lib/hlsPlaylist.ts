// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * HLS playlist rewriting (wave 2: serve video without going through Node).
 *
 * The FFmpeg worker writes playlists with **relative** URIs (`720p.m3u8`, `720p_003.ts`). Served as-is behind
 * `/api/media/:id/hls/:file`, every 2 s segment went back through the web process. They are now rewritten on the fly:
 *  - the **master** keeps relative URIs (hence the API) but appends the playback token, which avoids redoing
 *    the database access check for each rendition;
 *  - the **sub-playlist** replaces each segment with an absolute presigned MinIO URL: the player fetches the
 *    bytes from storage, never from the API again.
 *
 * Everything is pure and I/O-free: URL signing, for its part, lives in MediaService.
 */

/** Signing window of the segment URLs (s) — see `signingWindowStart`. */
export const HLS_URL_WINDOW_SEC = 15 * 60;

/**
 * Lifetime of the presigned segment URLs (s), counted from the window.
 *
 * **This is the real revocation delay of an internal review broadcast in HLS**, and it must be read as such:
 * a segment URL is bound to nobody (the S3 signature covers only the bucket, key and date), so removing a
 * member from a project, unpublishing a media or putting it in the trash does not cut off segments already
 * handed out — they stay readable for up to two hours (2 h 10 with the `StorageService` signing slice).
 *
 * These two hours are **accepted, not endured**: for a VOD, hls.js loads the sub-playlist ONCE and never
 * reloads it. Shortening the TTL would therefore not shorten the leak of a link already copied — it would cut
 * playback of a media left open longer than the TTL, at the first seek, i.e. in the middle of a dailies
 * screening. Closing it for good requires serving the segments behind a route that rechecks access (the
 * `lib/mediaToken` token is half of that), not tweaking the duration.
 */
export const HLS_URL_TTL_SEC = 2 * 60 * 60;

/**
 * Start of the current window (ms epoch).
 *
 * A presigned URL is unique per signing instant: signed on demand, twenty viewers of the same dailies would
 * ask for twenty different URLs for the same segment, and no shared cache could match them. The rewritten
 * playlist is therefore frozen per window: within fifteen minutes, everyone receives the SAME URLs — the
 * front cache (and the browser's on reload) becomes useful again.
 */
export function signingWindowStart(nowMs: number = Date.now(), windowSec = HLS_URL_WINDOW_SEC): number {
  const windowMs = windowSec * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

/**
 * Acceptable HLS file name: no separator, no `..`, no query. The same pattern as the route — rechecked here
 * because these names come from the CONTENT of a playlist and are used to build a storage key to presign.
 */
export function isSafeHlsName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..');
}

/** `URI="…"` attribute of a tag (`#EXT-X-MAP`, `#EXT-X-I-FRAME-STREAM-INF`, `#EXT-X-KEY`). */
const TAG_URI = /URI="([^"]*)"/g;

/**
 * Applies `map` to each URI of the playlist: bare lines (segment or sub-playlist) and `URI="…"` tag attributes.
 * Comments, tags and blank lines are returned intact, and the playlist keeps its line-by-line structure.
 */
export function rewritePlaylistUris(playlist: string, map: (uri: string) => string): string {
  return playlist
    .split('\n')
    .map((rawLine) => {
      const line = rawLine.replace(/\r$/, '');
      if (line.trim() === '') return line;
      if (line.startsWith('#')) return line.replace(TAG_URI, (_m, uri: string) => `URI="${map(uri)}"`);
      return map(line.trim());
    })
    .join('\n');
}

/** All URIs referenced by the playlist, in order, without duplicates. */
export function playlistUris(playlist: string): string[] {
  const found: string[] = [];
  rewritePlaylistUris(playlist, (uri) => {
    if (!found.includes(uri)) found.push(uri);
    return uri;
  });
  return found;
}

/**
 * Master → each sub-playlist carries the playback token in its query. URIs stay relative: the player resolves
 * them against the master's URL, hence against `/api/media/:id/hls/`.
 */
export function withPlaybackToken(master: string, token: string): string {
  const q = `pt=${encodeURIComponent(token)}`;
  return rewritePlaylistUris(master, (uri) => (uri.includes('?') ? `${uri}&${q}` : `${uri}?${q}`));
}

/**
 * Sub-playlist → each segment becomes the absolute URL supplied by `urls`. A URI absent from the table
 * (unexpected name, hence never presigned) is left relative: it falls back on the
 * `/api/media/:id/hls/:file` proxy, which keeps working. No playback breaks.
 */
export function withPresignedSegments(playlist: string, urls: ReadonlyMap<string, string>): string {
  return rewritePlaylistUris(playlist, (uri) => urls.get(uri) ?? uri);
}
