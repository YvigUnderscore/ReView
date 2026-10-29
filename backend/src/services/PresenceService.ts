// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getRedis, onHeartbeat, parseJson, publishRedis, redisStrings, subscribeRedis } from '../lib/redis';

/**
 * Presence online — **shared** state (Redis) + persistence of the last activity.
 *
 * The state used to live in two process `Map`s: a second replica saw half the studio online, and a restart
 * erased everyone's presence. It now lives in Redis, with one entry **per
 * connection** (and not per user), carrying an expiry: a killed replica sees its entries disappear by
 * themselves after a lease, whereas a per-user counter would have remained stuck forever.
 *
 * `getOnlineUserIds()` remains **synchronous** — it is the contract of its callers (admin, directory,
 * messaging): it reads a local mirror, refreshed at each local change, at each
 * notification from another replica, and at the heartbeat.
 */

/** Lease of a presence entry: three missed heartbeats and it disappears. */
export const PRESENCE_TTL_MS = 60_000;
/** Lease of the whole room: an abandoned review does not leave its key behind. */
const ROOM_TTL_MS = PRESENCE_TTL_MS * 3;
const WRITE_THROTTLE_MS = 30_000;

const ONLINE_KEY = 'review:presence:online';
const ONLINE_CHANNEL = 'review:presence:online';
const reviewKey = (mediaId: number): string => `review:presence:review:${mediaId}`;

/** One entry = one socket connection: `<userId>|<connectionId>`. */
const entryId = (userId: number, connectionId: string): string => `${userId}|${connectionId}`;
const userIdOf = (entry: string): number => Number(entry.slice(0, entry.indexOf('|')));

/** Record of a viewer in Redis: identity, arrival, expiry. */
interface StoredViewer {
  v: ReviewViewer;
  j: number;
  e: number;
}

const localConnections = new Map<string, number>();
const localReview = new Map<number, Map<string, { viewer: ReviewViewer; joinedAt: number }>>();
const lastWrite = new Map<number, number>();
let onlineMirror: number[] = [];
let wired = false;
let lastFailureLog = 0;

function warnRedis(err: unknown): void {
  const now = Date.now();
  if (now - lastFailureLog < 30_000) return;
  lastFailureLog = now;
  logger.warn({ err }, '[presence] Redis indisponible : présence dégradée');
}

type Broadcast = (onlineUserIds: number[]) => void;
let broadcast: Broadcast = () => {};

export function setPresenceBroadcaster(fn: Broadcast): void {
  broadcast = fn;
}

export function getOnlineUserIds(): number[] {
  return [...onlineMirror];
}

/** Subscription and heartbeat set up at the service's first real use. */
function ensureWiring(): void {
  if (wired) return;
  wired = true;
  subscribeRedis(ONLINE_CHANNEL, () => void safeRefreshOnline());
  onHeartbeat(presenceHeartbeat);
}

/**
 * Seeds the synchronisation at server start-up.
 *
 * Without it, a replica with no local socket would never have filled its mirror: the administration page
 * served by that replica would announce "nobody online" while the whole studio works on the other one.
 */
export function startPresenceSync(): void {
  ensureWiring();
  void safeRefreshOnline();
}

const sameIds = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Re-reads the list of connected users and broadcasts it if it has changed. The broadcast now follows the
 * changes coming from the other replicas, not only our own.
 */
async function refreshOnline(): Promise<void> {
  const now = Date.now();
  const redis = getRedis();
  await redis.call('ZREMRANGEBYSCORE', ONLINE_KEY, '-inf', now);
  const entries = redisStrings(await redis.call('ZRANGEBYSCORE', ONLINE_KEY, now, '+inf'));

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const entry of entries) {
    const id = userIdOf(entry);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  ids.sort((a, b) => a - b);

  if (sameIds(ids, onlineMirror)) return;
  onlineMirror = ids;
  broadcast([...ids]);
}

async function safeRefreshOnline(): Promise<void> {
  try {
    await refreshOnline();
  } catch (err) {
    warnRedis(err);
  }
}

async function presenceHeartbeat(): Promise<void> {
  const now = Date.now();
  const redis = getRedis();

  if (localConnections.size > 0) {
    const args: (string | number)[] = [];
    for (const [connectionId, userId] of localConnections)
      args.push(now + PRESENCE_TTL_MS, entryId(userId, connectionId));
    await redis.call('ZADD', ONLINE_KEY, ...args);
  }

  for (const [mediaId, connections] of [...localReview]) {
    if (connections.size === 0) {
      localReview.delete(mediaId);
      continue;
    }
    await writeReviewEntries(mediaId, connections, now);
  }

  await refreshOnline();
}

async function persistLastSeen(userId: number, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastWrite.get(userId) ?? 0) < WRITE_THROTTLE_MS) return;
  lastWrite.set(userId, now);
  try {
    await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
  } catch {
    /* user deleted in the meantime: ignored */
  }
}

/** Connection of a socket. `connectionId` identifies the tab, not the user. */
export async function markOnline(userId: number, connectionId: string): Promise<void> {
  ensureWiring();
  localConnections.set(connectionId, userId);
  const wasOnline = onlineMirror.includes(userId);
  try {
    await getRedis().call('ZADD', ONLINE_KEY, Date.now() + PRESENCE_TTL_MS, entryId(userId, connectionId));
  } catch (err) {
    warnRedis(err);
  }
  if (!wasOnline) await persistLastSeen(userId, true);
  await safeRefreshOnline();
  publishRedis(ONLINE_CHANNEL, 'online');
}

/** Disconnection of a socket: the user only goes offline with the last tab. */
export async function markOffline(userId: number, connectionId: string): Promise<void> {
  localConnections.delete(connectionId);
  try {
    await getRedis().call('ZREM', ONLINE_KEY, entryId(userId, connectionId));
  } catch (err) {
    warnRedis(err);
  }
  await safeRefreshOnline();
  if (!onlineMirror.includes(userId)) await persistLastSeen(userId, true);
  publishRedis(ONLINE_CHANNEL, 'online');
}

/** User activity (socket event): refreshes lastSeenAt without spamming the database. */
export async function touch(userId: number): Promise<void> {
  await persistLastSeen(userId);
}

// ── Presence per review (backlog P2 10.G) ────────────────────────────────────
// Viewers of a media under review: one Redis entry per connection, under a hash key per media. The broadcast
// (event `review:presence`) is done by SocketService on the room `review_{mediaId}` — which crosses the
// replicas via the adapter.

export interface ReviewViewer {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

async function writeReviewEntries(
  mediaId: number,
  connections: Map<string, { viewer: ReviewViewer; joinedAt: number }>,
  now: number,
): Promise<void> {
  const args: string[] = [];
  for (const [connectionId, { viewer, joinedAt }] of connections) {
    const stored: StoredViewer = { v: viewer, j: joinedAt, e: now + PRESENCE_TTL_MS };
    args.push(entryId(viewer.id, connectionId), JSON.stringify(stored));
  }
  const redis = getRedis();
  await redis.call('HSET', reviewKey(mediaId), ...args);
  await redis.call('PEXPIRE', reviewKey(mediaId), ROOM_TTL_MS);
}

/** Local view (fallback when Redis does not answer): better than a displayed empty room. */
function localViewers(mediaId: number): ReviewViewer[] {
  return [...(localReview.get(mediaId)?.values() ?? [])]
    .sort((a, b) => a.joinedAt - b.joinedAt || a.viewer.id - b.viewer.id)
    .filter((e, i, all) => all.findIndex((o) => o.viewer.id === e.viewer.id) === i)
    .map((e) => e.viewer);
}

export async function getReviewViewers(mediaId: number): Promise<ReviewViewer[]> {
  const now = Date.now();
  let flat: string[];
  try {
    flat = redisStrings(await getRedis().call('HGETALL', reviewKey(mediaId)));
  } catch (err) {
    warnRedis(err);
    return localViewers(mediaId);
  }

  const stale: string[] = [];
  // A user may have several tabs: we keep the freshest identity (last join, most recent presigned avatar) and
  // the rank of their first arrival.
  const best = new Map<number, { viewer: ReviewViewer; newest: number; first: number }>();
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const field = flat[i]!;
    const stored = parseJson<StoredViewer>(flat[i + 1]);
    if (!stored || typeof stored.e !== 'number' || typeof stored.v?.id !== 'number' || stored.e <= now) {
      stale.push(field);
      continue;
    }
    const current = best.get(stored.v.id);
    if (!current) {
      best.set(stored.v.id, { viewer: stored.v, newest: stored.j, first: stored.j });
      continue;
    }
    current.first = Math.min(current.first, stored.j);
    if (stored.j >= current.newest) {
      current.newest = stored.j;
      current.viewer = stored.v;
    }
  }

  if (stale.length > 0) {
    void getRedis()
      .call('HDEL', reviewKey(mediaId), ...stale)
      .catch(warnRedis);
  }

  return [...best.values()]
    .sort((a, b) => a.first - b.first || a.viewer.id - b.viewer.id)
    .map((e) => e.viewer);
}

/** A viewer's entry (one entry per tab) → list up to date. */
export async function joinReview(
  mediaId: number,
  viewer: ReviewViewer,
  connectionId: string,
): Promise<ReviewViewer[]> {
  ensureWiring();
  const now = Date.now();
  let connections = localReview.get(mediaId);
  if (!connections) {
    connections = new Map();
    localReview.set(mediaId, connections);
  }
  connections.set(connectionId, { viewer, joinedAt: connections.get(connectionId)?.joinedAt ?? now });

  try {
    await writeReviewEntries(mediaId, new Map([[connectionId, connections.get(connectionId)!]]), now);
  } catch (err) {
    warnRedis(err);
  }
  return getReviewViewers(mediaId);
}

/** A viewer's exit (last tab → removed from the list) → list up to date. */
export async function leaveReview(
  mediaId: number,
  userId: number,
  connectionId: string,
): Promise<ReviewViewer[]> {
  const connections = localReview.get(mediaId);
  connections?.delete(connectionId);
  if (connections && connections.size === 0) localReview.delete(mediaId);

  try {
    await getRedis().call('HDEL', reviewKey(mediaId), entryId(userId, connectionId));
  } catch (err) {
    warnRedis(err);
  }
  return getReviewViewers(mediaId);
}

/** Reset of the local state (tests) — Redis is not touched. */
export function __resetPresence(): void {
  localConnections.clear();
  localReview.clear();
  lastWrite.clear();
  onlineMirror = [];
  wired = false;
  lastFailureLog = 0;
  broadcast = () => {};
}
