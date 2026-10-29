// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Readable } from 'node:stream';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { storage } from '../lib/storage';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { logMediaAccess } from '../lib/mediaAccess';
import { hlsContentType } from '../lib/hls';
import {
  HLS_URL_TTL_SEC,
  isSafeHlsName,
  playlistUris,
  signingWindowStart,
  withPlaybackToken,
  withPresignedSegments,
} from '../lib/hlsPlaylist';
import { signMediaPlaybackToken, verifyMediaPlaybackToken } from '../lib/mediaToken';
import { forbidden, notFound } from '../lib/errors';
import type { SessionUser } from './mediaShared';

/**
 * ── HLS delivery (Phase 23, revised in wave 2: video no longer goes through Node) ────────────
 *
 * Before: each 2 s segment went back through the web process after three Prisma access-control
 * queries and was sent with `private, max-age=60`, even though the content is immutable. A
 * ten-minute shot cost ~300 requests per rendition and per viewer, all charged to the shared
 * per-IP rate limit, which is what capped the dailies.
 *
 * Now there are three levels:
 *  1. `master.m3u8`: the database authorization is paid **here, once** (with the access log).
 *     The returned master attaches a read token to each rendition.
 *  2. `<rendition>.m3u8?pt=...`: the token stands in for authorization: HMAC check, zero SQL
 *     queries. The returned sub-playlist points to presigned MinIO URLs.
 *  3. segments: served directly by storage. No video bytes go through Node.
 *
 * The historical proxy `/api/media/:id/hls/<segment>.ts` is still served (clients without a
 * rewritten manifest, unexpected segment names): nothing breaks, but it is no longer the nominal
 * path, and it now sets an immutable cache.
 */

/** Response for an HLS file: a text body (rewritten playlist) or a stream (segment fallback). */
export interface HlsFileResponse {
  contentType: string;
  cacheControl: string;
  body?: string;
  stream?: Readable;
}

/** A segment never changes: once fetched, it never needs to be requested again. */
const HLS_SEGMENT_CACHE_CONTROL = 'private, max-age=31536000, immutable';
/** Playlists carry a token and signed URLs: never a shared cache. */
const HLS_PLAYLIST_CACHE_CONTROL = 'private, no-store';

const hlsKey = (id: number, file: string) => `derived/${id}/hls/${file}`;

/** The full access check: the three queries that the read token avoids afterwards. */
async function assertHlsRead(user: SessionUser, id: number): Promise<void> {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { published: true, uploaderId: true, versionId: true },
  });
  if (!media) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
}

async function readHlsText(id: number, file: string): Promise<string> {
  const buf = await storage
    .getObjectBuffer(hlsKey(id, file))
    .catch(() => Promise.reject(notFound('HLS file not found')));
  return buf.toString('utf8');
}

/**
 * Rewritten sub-playlists, **frozen per signature window**.
 *
 * Otherwise two viewers would receive two different sets of presigned URLs for the same
 * segments (the signature depends on the instant), and no shared cache could match them.
 * By freezing the playlist per fifteen-minute window, the twenty viewers of a daily request
 * exactly the same URLs, so the front end reads each segment from storage only once. Accepted
 * corollary: a regenerated HLS ladder (reprocess) may be announced with at most one window of delay.
 */
interface RenditionEntry {
  /** Size of the cached text, counted once resolved (0 while the read is in flight). */
  bytes: number;
  text: Promise<string>;
}

const renditionCache = new Map<string, RenditionEntry>();
let renditionCacheBytes = 0;
/** Signature window covered by the cache contents (-1 = empty cache). */
let renditionCacheWindow = -1;

/**
 * Entry cap, sized for a dailies room rather than picked at random.
 *
 * One entry = one rendition of a media. Measured on the dev stack: a transcoded media has 1 to 3
 * renditions (360p/720p/1080p depending on the source). A dailies playlist of fifteen to thirty
 * shots thus consumes 45 to 120 entries within the same signature window. The old cap of 32
 * evicted them continuously, and since eviction was strict FIFO with no refresh on read, a
 * cyclic traversal of the playlist systematically evicted the entry about to be needed: zero hit
 * rate, precisely in the case the cache was meant to serve. 512 covers a 128-shot playlist with
 * 4 renditions.
 */
const RENDITION_CACHE_MAX = 512;

/**
 * Memory cap: the real bound, because an entry's size varies by two orders of magnitude.
 * Measured: a rewritten sub-playlist of a 52 s shot with 2 s segments weighs 11.3 kB (27
 * segments x ~420 B of presigned URL); a ten-minute cut would weigh ~126 kB. Counting entries
 * alone would let the cache weigh anywhere from 6 to 64 MB depending on content. 8 MB compares
 * with the ~2 MB of the signature cache (`PRESIGN_CACHE_MAX`), and it is the cap that bites
 * first on long cuts.
 */
const RENDITION_CACHE_MAX_BYTES = 8 * 1024 * 1024;

/** Reads the sub-playlist and rewrites each segment as a presigned URL. No cache here. */
async function buildPresignedRendition(id: number, file: string): Promise<string> {
  const text = await readHlsText(id, file);
  const names = playlistUris(text).filter(isSafeHlsName);
  const signed = await Promise.all(
    names.map(
      async (name) => [name, await storage.getPresignedGetUrl(hlsKey(id, name), HLS_URL_TTL_SEC)] as const,
    ),
  );
  return withPresignedSegments(text, new Map(signed));
}

/** Evicts the least recently READ entries until back under both caps. */
function evictRenditions(): void {
  while (renditionCache.size > RENDITION_CACHE_MAX || renditionCacheBytes > RENDITION_CACHE_MAX_BYTES) {
    const oldest = renditionCache.entries().next();
    if (oldest.done) break;
    renditionCache.delete(oldest.value[0]);
    renditionCacheBytes -= oldest.value[1].bytes;
  }
}

async function presignedRendition(id: number, file: string): Promise<string> {
  const windowStart = signingWindowStart();
  // The key carries the window: when the window changes, ALL content goes stale at once. A
  // `clear()` is therefore exactly the former key-by-key sweep, in O(1).
  if (windowStart !== renditionCacheWindow) {
    renditionCache.clear();
    renditionCacheBytes = 0;
    renditionCacheWindow = windowStart;
  }
  const cacheKey = `${windowStart}:${id}:${file}`;

  const hit = renditionCache.get(cacheKey);
  if (hit) {
    // LRU: reading refreshes the entry (a Map iterates in insertion order). With strict FIFO,
    // the rendition just served would remain the next to be evicted.
    renditionCache.delete(cacheKey);
    renditionCache.set(cacheKey, hit);
    return hit.text;
  }

  // Memoize the PROMISE, not the text. Without this the cache only matched SEQUENTIAL viewers:
  // the twenty viewers of a daily arrive together, all miss the cache, and each redoes its
  // MinIO read and its signature set.
  const entry: RenditionEntry = { bytes: 0, text: buildPresignedRendition(id, file) };
  renditionCache.set(cacheKey, entry);
  void entry.text.then(
    (text) => {
      if (renditionCache.get(cacheKey) !== entry) return;
      entry.bytes = Buffer.byteLength(text, 'utf8');
      renditionCacheBytes += entry.bytes;
      evictRenditions();
    },
    () => {
      // A failure is not memoized: the next read must be able to retry.
      if (renditionCache.get(cacheKey) === entry) renditionCache.delete(cacheKey);
    },
  );
  return entry.text;
}

/** Empties the sub-playlist cache (tests, and an entry point if a purger needs it). */
export function resetHlsPlaylistCache(): void {
  renditionCache.clear();
  renditionCacheBytes = 0;
  renditionCacheWindow = -1;
}

/** Sub-playlist cache counters: read by tests, never by a route. */
export const __hlsCacheTesting = {
  stats: () => ({ entries: renditionCache.size, bytes: renditionCacheBytes }),
  RENDITION_CACHE_MAX,
  RENDITION_CACHE_MAX_BYTES,
};

/**
 * HLS manifest or segment (`derived/{id}/hls/{file}`). `file` is validated by the route;
 * it is re-validated here because it composes a storage key.
 */
export async function getHlsFile(
  user: SessionUser,
  id: number,
  file: string,
  opts: { playbackToken?: string; ip?: string } = {},
): Promise<HlsFileResponse> {
  if (!isSafeHlsName(file)) throw notFound('HLS file not found');
  const contentType = hlsContentType(file);
  const isMaster = file === 'master.m3u8';
  // A valid read token skips the database check; if absent or invalid (expired, other media,
  // other account), the full check is redone: never a surprise refusal.
  if (isMaster || !verifyMediaPlaybackToken(opts.playbackToken, id, user.id)) await assertHlsRead(user, id);

  if (isMaster) {
    // Access log (36.E), deduplicated over a 30 min window: viewing stays traced even though
    // segments no longer go through the API.
    logMediaAccess({ mediaObjectId: id, userId: user.id, ip: opts.ip ?? null });
    const master = await readHlsText(id, file);
    return {
      contentType,
      cacheControl: HLS_PLAYLIST_CACHE_CONTROL,
      body: withPlaybackToken(master, signMediaPlaybackToken(id, user.id)),
    };
  }

  if (file.endsWith('.m3u8'))
    return {
      contentType,
      cacheControl: HLS_PLAYLIST_CACHE_CONTROL,
      body: await presignedRendition(id, file),
    };

  const stream = await storage
    .getObjectStream(hlsKey(id, file))
    .catch(() => Promise.reject(notFound('HLS file not found')));
  return { contentType, cacheControl: HLS_SEGMENT_CACHE_CONTROL, stream };
}
