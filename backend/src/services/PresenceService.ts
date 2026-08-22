// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getRedis, onHeartbeat, parseJson, publishRedis, redisStrings, subscribeRedis } from '../lib/redis';

/**
 * Présence en ligne — état **partagé** (Redis) + persistance de la dernière activité.
 *
 * L'état vivait dans deux `Map` de process : une seconde réplique voyait la moitié du
 * studio en ligne, et un redémarrage effaçait la présence de tout le monde. Il vit
 * désormais dans Redis, une entrée **par connexion** (et non par utilisateur), porteuse
 * d'une échéance : une réplique tuée voit ses entrées disparaître d'elles-mêmes au bout
 * d'un bail, là où un compteur par utilisateur serait resté bloqué à un pour toujours.
 *
 * `getOnlineUserIds()` reste **synchrone** — c'est le contrat de ses appelants (admin,
 * annuaire, messagerie) : il lit un miroir local, rafraîchi à chaque changement local,
 * à chaque notification d'une autre réplique, et au battement de cœur.
 */

/** Bail d'une entrée de présence : trois battements de cœur manqués et elle disparaît. */
export const PRESENCE_TTL_MS = 60_000;
/** Bail de la salle entière : une review désertée ne laisse pas sa clé derrière elle. */
const ROOM_TTL_MS = PRESENCE_TTL_MS * 3;
const WRITE_THROTTLE_MS = 30_000;

const ONLINE_KEY = 'review:presence:online';
const ONLINE_CHANNEL = 'review:presence:online';
const reviewKey = (mediaId: number): string => `review:presence:review:${mediaId}`;

/** Une entrée = une connexion socket : `<userId>|<idDeConnexion>`. */
const entryId = (userId: number, connectionId: string): string => `${userId}|${connectionId}`;
const userIdOf = (entry: string): number => Number(entry.slice(0, entry.indexOf('|')));

/** Enregistrement d'un spectateur dans Redis : identité, arrivée, échéance. */
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

/** Souscription et battement de cœur posés à la première utilisation réelle du service. */
function ensureWiring(): void {
  if (wired) return;
  wired = true;
  subscribeRedis(ONLINE_CHANNEL, () => void safeRefreshOnline());
  onHeartbeat(presenceHeartbeat);
}

/**
 * Amorce la synchronisation au démarrage du serveur.
 *
 * Sans elle, une réplique sans socket local n'aurait jamais rempli son miroir : la page
 * d'administration servie par cette réplique-là annoncerait « personne en ligne » alors
 * que tout le studio travaille sur l'autre.
 */
export function startPresenceSync(): void {
  ensureWiring();
  void safeRefreshOnline();
}

const sameIds = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Relit la liste des connectés et diffuse si elle a changé. La diffusion suit désormais
 * les changements venus des autres répliques, pas seulement les nôtres.
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
    /* utilisateur supprimé entre-temps : on ignore */
  }
}

/** Connexion d'un socket. `connectionId` identifie l'onglet, pas l'utilisateur. */
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

/** Déconnexion d'un socket : l'utilisateur ne passe hors ligne qu'au dernier onglet. */
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

/** Activité utilisateur (event socket) : rafraîchit lastSeenAt sans spammer la base. */
export async function touch(userId: number): Promise<void> {
  await persistLastSeen(userId);
}

// ── Présence par review (backlog P2 10.G) ────────────────────────────────────
// Spectateurs d'un média en cours de review : une entrée Redis par connexion, sous une
// clé de hachage par média. La diffusion (event `review:presence`) est faite par
// SocketService sur la room `review_{mediaId}` — qui traverse les répliques via l'adapter.

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

/** Vue locale (repli quand Redis ne répond pas) : mieux qu'une salle affichée vide. */
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
  // Un utilisateur peut avoir plusieurs onglets : on garde l'identité la plus fraîche
  // (dernier join, avatar présigné le plus récent) et le rang de sa première arrivée.
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

/** Entrée d'un spectateur (une entrée par onglet) → liste à jour. */
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

/** Sortie d'un spectateur (dernier onglet → retiré de la liste) → liste à jour. */
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

/** Réinitialisation de l'état local (tests) — Redis n'est pas touché. */
export function __resetPresence(): void {
  localConnections.clear();
  localReview.clear();
  lastWrite.clear();
  onlineMirror = [];
  wired = false;
  lastFailureLog = 0;
  broadcast = () => {};
}
