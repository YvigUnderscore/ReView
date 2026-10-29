// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Decides which track the player should open: the HLS ladder or the MP4 file.
 *
 * This is not only a bandwidth question. Non-destructive trimming does **not** produce new
 * renditions: it burns the trim into a dedicated MP4 proxy (`trimProxyKey`) and leaves the
 * HLS ladder untouched, i.e. built from the full media. Preferring the HLS master whenever it
 * exists (the default) would therefore replay the untrimmed media: the in and out points set
 * by the user had no effect, and the shading of trimmed areas vanished from the timeline the
 * moment the trim became active. Nothing on screen signalled it.
 *
 * While the trimmed proxy is not ready, the HLS master remains the right choice: it shows the
 * full media, and the timeline greys out what will be removed.
 */

export interface VideoSourceMedia {
  /** Available HLS renditions (`null`: media transcoded before the adaptive ladder existed). */
  hls: unknown;
  /** Bounds of the non-destructive trim, in frames. */
  trim: unknown;
  /** The trimmed proxy has been produced and is served by `proxyUrl`. */
  trimProxyReady: boolean;
}

/**
 * Whether the HLS master can be served. Not while a trim is effective: only the MP4 proxy
 * carries the trim.
 */
export function canPlayHlsMaster(media: VideoSourceMedia): boolean {
  return Boolean(media.hls) && !(Boolean(media.trim) && media.trimProxyReady);
}

/** URL of the HLS master served by the authenticated proxy, or `null` if it must not be served. */
export function hlsMasterUrl(mediaId: number, media: VideoSourceMedia): string | null {
  return canPlayHlsMaster(media) ? `/api/media/${String(mediaId)}/hls/master.m3u8` : null;
}
