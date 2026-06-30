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
