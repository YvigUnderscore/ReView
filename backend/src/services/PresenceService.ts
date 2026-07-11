import { prisma } from '../lib/prisma';

/**
 * Présence en ligne (in-memory) + persistance de la dernière activité.
 *  - `online` : Map userId → nombre de sockets connectés (multi-onglets).
 *  - `lastSeenAt` en base : mis à jour à la connexion, à la déconnexion et
 *    périodiquement sur activité (throttle pour éviter d'écrire à chaque event).
 * La diffusion temps réel passe par Socket.io (event `presence:update`).
 */
const online = new Map<number, number>();
const lastWrite = new Map<number, number>();
const WRITE_THROTTLE_MS = 30_000;

type Broadcast = (onlineUserIds: number[]) => void;
let broadcast: Broadcast = () => {};

export function setPresenceBroadcaster(fn: Broadcast): void {
  broadcast = fn;
}

export function getOnlineUserIds(): number[] {
  return [...online.keys()];
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

export async function markOnline(userId: number): Promise<void> {
  const count = online.get(userId) ?? 0;
  online.set(userId, count + 1);
  if (count === 0) {
    await persistLastSeen(userId, true);
    broadcast(getOnlineUserIds());
  }
}

export async function markOffline(userId: number): Promise<void> {
  const count = online.get(userId) ?? 0;
  if (count <= 1) {
    online.delete(userId);
    await persistLastSeen(userId, true);
    broadcast(getOnlineUserIds());
  } else {
    online.set(userId, count - 1);
  }
}

/** Activité utilisateur (event socket) : rafraîchit lastSeenAt sans spammer la base. */
export async function touch(userId: number): Promise<void> {
  await persistLastSeen(userId);
}

// ── Présence par review (backlog P2 10.G) ────────────────────────────────────
// Spectateurs d'un média en cours de review, in-memory : mediaId → userId →
// { identité publique, nombre d'onglets }. La diffusion (event `review:presence`)
// est faite par SocketService sur la room `review_{mediaId}`.

export interface ReviewViewer {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

const reviewRooms = new Map<number, Map<number, { viewer: ReviewViewer; count: number }>>();

export function getReviewViewers(mediaId: number): ReviewViewer[] {
  return [...(reviewRooms.get(mediaId)?.values() ?? [])].map((e) => e.viewer);
}

/** Entrée d'un spectateur (multi-onglets : compteur) → liste à jour. */
export function joinReview(mediaId: number, viewer: ReviewViewer): ReviewViewer[] {
  let room = reviewRooms.get(mediaId);
  if (!room) {
    room = new Map();
    reviewRooms.set(mediaId, room);
  }
  const entry = room.get(viewer.id);
  if (entry) {
    entry.count += 1;
    entry.viewer = viewer; // identité rafraîchie (avatar présigné le plus récent)
  } else {
    room.set(viewer.id, { viewer, count: 1 });
  }
  return getReviewViewers(mediaId);
}

/** Sortie d'un spectateur (dernier onglet → retiré de la liste) → liste à jour. */
export function leaveReview(mediaId: number, userId: number): ReviewViewer[] {
  const room = reviewRooms.get(mediaId);
  const entry = room?.get(userId);
  if (room && entry) {
    if (entry.count <= 1) room.delete(userId);
    else entry.count -= 1;
    if (room.size === 0) reviewRooms.delete(mediaId);
  }
  return getReviewViewers(mediaId);
}
