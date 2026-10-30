// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server as HttpServer } from 'node:http';
import type { Role } from '@prisma/client';
import { createRedisClient, enableRedisTransport, subscribeRedis } from '../lib/redis';
import { registerShutdownTask, SHUTDOWN_PHASE } from '../lib/gracefulShutdown';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { authenticateSocket, type AuthedSocket } from './socketAuth';
import { getAuthUser } from '../lib/userCache';
import {
  isSessionActive,
  decodeSessionRevocation,
  markSessionsRevoked,
  SESSION_REVOCATION_CHANNEL,
} from '../lib/sessions';
import { attachSocketRateLimit } from '../lib/socketRateLimit';
import { checkProjectAccess } from '../middleware/rbac';
import { env } from '../config/env';
import {
  markOnline,
  markOffline,
  touch,
  setPresenceBroadcaster,
  joinReview,
  leaveReview,
  getReviewViewers,
  startPresenceSync,
} from './PresenceService';
import { resolveProjectIdForMedia } from '../lib/pipeline';
import { toPublicUser } from '../lib/userView';
import {
  parseLiveKey,
  joinLive,
  leaveLive,
  handoffLive,
  setCoHost,
  canDriveLive,
  isLiveDriver,
  claimDrive,
  getLiveState,
  getLiveProjectId,
  scheduleLiveLeave,
  cancelLiveLeave,
  startLiveSync,
  type LiveParticipant,
  type LiveSessionMeta,
  type LiveState,
} from './LiveSessionService';
import { notifyPlaylistLiveStarted } from './NotificationService';
import { subscribeWorkerEvents } from '../lib/workerEvents';

let io: SocketServer | undefined;

// The handshake check lives in `socketAuth`: it is a security boundary, and it has its own tests
// rather than being an inaccessible closure.
export type { AuthedSocket };

/**
 * Revalidation cadence for established connections (A3-02).
 *
 * `authenticateSocket` only runs at handshake: afterwards `socket.user` is frozen and the connection lives
 * as long as the transport holds, that is, for days. Revoking a session or demoting a role therefore cut the
 * API within thirty seconds without changing anything on the real-time channel: the tab left open kept
 * receiving the project's internal comments (including those hidden from clients, with the presigned URLs of
 * their attachments), and its former role reopened `join_project` for it.
 *
 * One minute is a deliberate trade-off: shorter would gain nothing (session and identity are each cached for
 * thirty seconds on either side), longer would let a departing user keep listening.
 */
const REVALIDATE_INTERVAL_MS = 60_000;

/**
 * Replays the gate checks on an established socket: live session, existing and active account, current role.
 * Returns `false` when the connection should no longer exist.
 *
 * The role is **re-read and rewritten**, not merely checked: `join_review`, `live:join` and `join_project`
 * consult `socket.user.role`, and `resolveProjectAccess` grants global access to ADMIN as well as SUPERVISOR.
 * Leaving it frozen would have given a demotion the lifetime of an open tab.
 *
 * Cost: no query per message. `isSessionActive` and `getAuthUser` each have a thirty-second cache, so at worst
 * one read per account per sweep.
 */
export async function revalidateSocket(socket: AuthedSocket): Promise<boolean> {
  const current = socket.user;
  // A share guest has neither session nor role: their access rests on the ShareLink, rechecked
  // on the API side at every read. Nothing to replay here.
  if (!current) return true;
  if (!socket.authSid || !(await isSessionActive(socket.authSid))) return false;
  const fresh = await getAuthUser(current.id);
  if (!fresh || fresh.disabledAt) return false;
  socket.user = { id: fresh.id, email: fresh.email, role: fresh.role };
  return true;
}

/**
 * Sweeps the sockets of THIS replica: each one holds its own; the Redis adapter is only used for emissions.
 *
 * A database or Redis outage must not disconnect the whole studio: a failed check keeps the connection (the
 * API, for its part, fails closed). That is the operational choice, not an oversight.
 */
export async function sweepSockets(server: SocketServer): Promise<void> {
  for (const socket of server.sockets.sockets.values()) {
    const authed = socket as AuthedSocket;
    const keep = await revalidateSocket(authed).catch((err: unknown) => {
      logger.warn({ err }, '[socket] revalidation failed: connection kept');
      return true;
    });
    if (!keep) authed.disconnect(true);
  }
}

/**
 * Closes, without waiting for the sweep, the connections carried by a revoked session
 * (A3-02, immediate part). Returns the number of connections closed.
 *
 * Matching is done on the exact `sid`, not on the user: this is why "revoke all my sessions except this one"
 * does not disconnect the author of the action, since the spared session is simply not in the published list.
 *
 * Bounded to THIS replica, like `sweepSockets`: each process holds its own sockets, and the Redis adapter is
 * only used for emissions. Publication on the channel carries the order to the others.
 */
export function disconnectRevokedSockets(server: SocketServer, sids: readonly string[]): number {
  const revoked = new Set(sids);
  let closed = 0;
  for (const socket of server.sockets.sockets.values()) {
    const authed = socket as AuthedSocket;
    if (!authed.authSid || !revoked.has(authed.authSid)) continue;
    authed.disconnect(true);
    closed += 1;
  }
  return closed;
}

/**
 * Initializes Socket.io with JWT auth (user) or share token (ShareLink, becomes a guest).
 */
export const initSocket = (server: HttpServer): SocketServer => {
  const socketServer = new SocketServer(server, {
    // Same resolution as over HTTP (see app.ts): a comma-separated list must yield N origins,
    // not a single string that would never match.
    cors: {
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      methods: ['GET', 'POST'],
    },
  });
  io = socketServer;

  attachRedisAdapter(socketServer);

  // Mirrors of the volatile state: to be seeded at startup, otherwise a replica without a local socket
  // would announce "nobody online" and "no live room" to those it serves.
  startPresenceSync();
  startLiveSync();

  // Broadcast of the list of online users. `local` is essential: each replica holds its own presence
  // mirror and broadcasts it. Without `local`, the adapter would relay the same list N times through the N replicas.
  setPresenceBroadcaster((onlineUserIds) => io?.local.emit('presence:update', { onlineUserIds }));

  relayWorkerEvents();

  // socket.io expects a synchronous middleware: the asynchronous check is detached, `next` being called on
  // every path. The `catch` closes the door if the check itself fails; without it, the socket would hang.
  socketServer.use((socket: AuthedSocket, next) => {
    void authenticateSocket(socket, next).catch(() => next(new Error('Authentication error')));
  });

  startRevalidation(socketServer);
  subscribeSessionRevocations();
  socketServer.on('connection', (socket: AuthedSocket) => onConnection(socketServer, socket));
  return socketServer;
};

/**
 * Redis adapter: without it, an emission never leaves the process that produced it. With two replicas,
 * half of a dailies room receives nothing: horizontal scaling would be impossible, not merely degraded.
 */
function attachRedisAdapter(socketServer: SocketServer): void {
  const pub = createRedisClient('socket-pub');
  const sub = createRedisClient('socket-sub');
  socketServer.adapter(createAdapter(pub, sub));
  enableRedisTransport();
  registerShutdownTask({
    name: 'socket.io-adapter',
    phase: SHUTDOWN_PHASE.DISCONNECT,
    run: async () => {
      await Promise.all(
        [pub, sub].map((client) =>
          client.quit().catch((err: unknown) => {
            logger.warn({ err }, '[socket] unclean shutdown of an adapter connection');
            client.disconnect();
          }),
        ),
      );
    },
  });
}

/**
 * Events from the FFmpeg worker (34.F, Redis pub/sub): progressive HLS scaling. The review reloads its
 * master (new qualities), the project refreshes its cards.
 */
function relayWorkerEvents(): void {
  subscribeWorkerEvents((e) => {
    if (e.type === 'project') {
      // Relays the worker's emissions to a project's room: it has no socket server, so its direct
      // `emitToProject` calls went nowhere.
      emitToProject(e.projectId, e.event, e.payload);
      return;
    }
    if (e.type === 'markers') {
      // Scene detection (34.H): "Shot n" markers set, so the review reloads its list.
      emitToReview(e.mediaId, 'markers:changed', { mediaId: e.mediaId });
      return;
    }
    emitToReview(e.mediaId, 'hls:changed', e);
    if (e.projectId != null)
      emitToProject(e.projectId, 'media:update', {
        projectId: e.projectId,
        id: e.mediaId,
        versionId: e.versionId,
      });
  });
}

/**
 * The handshake is only valid for the instant it takes place: afterwards, only this clock brings the
 * connection closer to the real state of the account (A3-02).
 */
function startRevalidation(socketServer: SocketServer): void {
  const revalidation = setInterval(() => void sweepSockets(socketServer), REVALIDATE_INTERVAL_MS);
  // This clock must not, on its own, keep the process alive: the HTTP server does that, and shutdown
  // clears it cleanly just below.
  revalidation.unref();
  registerShutdownTask({
    name: 'socket-revalidation',
    phase: SHUTDOWN_PHASE.STOP_INTAKE,
    run: () => {
      clearInterval(revalidation);
      return Promise.resolve();
    },
  });
}

/**
 * Immediate part of revocation: the subscription lives here because the replica that served the
 * `DELETE /sessions` is not necessarily the one hosting the revoked user's websocket. The one-minute sweep
 * stays in place: it is the safety net when this message is lost (best-effort publication, Redis down,
 * replica starting up).
 */
function subscribeSessionRevocations(): void {
  subscribeRedis(SESSION_REVOCATION_CHANNEL, (raw) => {
    const sids = decodeSessionRevocation(raw);
    if (sids.length === 0) return;
    // This replica's validity cache still believes the session alive (30 s TTL): without this write,
    // closing the socket would be pointless, since the API would reopen it.
    markSessionsRevoked(sids);
    if (!io) return;
    const closed = disconnectRevokedSockets(io, sids);
    if (closed > 0) logger.info({ closed }, '[socket] session revoked: connections closed');
  });
}

/** A new connection: rate guard, then the rooms of an authenticated user, then the project rooms. */
function onConnection(socketServer: SocketServer, socket: AuthedSocket): void {
  // First statement of the body: the rate guard must be set before any handler becomes reachable. It is
  // what refuses the packet BEFORE `socket.on`, hence before the Postgres query that `join_review` would
  // issue to refuse it.
  attachSocketRateLimit(socket);

  if (socket.user) {
    // `join`/`leave` return a promise with distributed adapters; the in-memory adapter resolves
    // synchronously, hence the `void` on calls made outside an async context.
    void socket.join(`user_${socket.user.id}`);
    const uid = socket.user.id;
    // Presence is counted **per connection**: the socket identifier tells tabs apart, and lets an
    // orphaned entry (killed replica) expire on its own.
    const conn = socket.id;
    void markOnline(uid, conn);
    // Activity: the client emits `activity` (interactions), which refreshes lastSeenAt.
    socket.on('activity', () => void touch(uid));

    const leaveReviews = registerReviewPresence(socketServer, socket, uid, conn);
    const leaveLives = registerLiveRoom(socketServer, socket, uid);
    socket.on('disconnect', () => {
      void markOffline(uid, conn);
      leaveReviews();
      leaveLives();
    });
  }
  registerProjectRooms(socket);
}

/**
 * Role and session re-read before granting: `socket.user.role` dates from the handshake, and
 * `revalidateSocket` rewrites it. `null` when the connection must not go on.
 */
async function freshRole(socket: AuthedSocket): Promise<Role | null> {
  if (!(await revalidateSocket(socket))) {
    socket.disconnect(true);
    return null;
  }
  return socket.user?.role ?? null;
}

/** Public identity of a participant (review presence, live room), read once per entry. */
async function publicParticipant(uid: number) {
  const raw = await prisma.user.findUnique({
    where: { id: uid },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      username: true,
      avatarKey: true,
    },
  });
  if (!raw) return null;
  const pub = await toPublicUser(raw);
  return { id: pub.id, displayName: pub.displayName, initials: pub.initials, avatarUrl: pub.avatarUrl };
}

/**
 * Per-review presence: "watching now" avatars (backlog P2 10.G). RBAC rechecked at join; public identity
 * resolved once per entry. Returns what to do when the socket goes away.
 */
function registerReviewPresence(
  socketServer: SocketServer,
  socket: AuthedSocket,
  uid: number,
  conn: string,
): () => void {
  const joinedReviews = new Set<number>();
  const broadcast = (mediaId: number, viewers: unknown) =>
    socketServer.to(`review_${mediaId}`).emit('review:presence', { mediaId, viewers });
  const emitViewers = async (mediaId: number): Promise<void> => {
    broadcast(mediaId, await getReviewViewers(mediaId));
  };
  socket.on('join_review', async (mediaId: number) => {
    const mid = Number(mediaId);
    if (!Number.isInteger(mid)) return;
    if (joinedReviews.has(mid)) return emitViewers(mid);
    const role = await freshRole(socket);
    if (!role) return;
    const projectId = await resolveProjectIdForMedia(mid);
    if (!projectId || !(await checkProjectAccess(uid, role, projectId))) return;
    const participant = await publicParticipant(uid);
    if (!participant) return;
    await socket.join(`review_${mid}`);
    joinedReviews.add(mid);
    broadcast(mid, await joinReview(mid, participant, conn));
  });
  socket.on('leave_review', (mediaId: number) => {
    const mid = Number(mediaId);
    if (!joinedReviews.delete(mid)) return;
    void socket.leave(`review_${mid}`);
    void leaveReview(mid, uid, conn).then((viewers) => broadcast(mid, viewers));
  });
  return () => {
    for (const mid of joinedReviews) {
      void leaveReview(mid, uid, conn).then((viewers) => broadcast(mid, viewers));
    }
    joinedReviews.clear();
  };
}

/** Project of a live room key: the media's, or the playlist's. */
async function resolveLiveProject(key: string): Promise<number | null> {
  const target = parseLiveKey(key);
  if (!target) return null;
  if (target.type === 'media') return resolveProjectIdForMedia(target.id);
  const playlist = await prisma.playlist.findUnique({
    where: { id: target.id },
    select: { projectId: true },
  });
  return playlist?.projectId ?? null;
}

/**
 * Live review room (33.B): rooms `live_<key>`, driver + viewers. RBAC rechecked at join (media or playlist
 * to project); `live:sync` is relayed only from the driver, opaque payload (playhead/pause/current
 * media/camera). Returns what to do when the socket goes away.
 */
function registerLiveRoom(socketServer: SocketServer, socket: AuthedSocket, uid: number): () => void {
  const joinedLives = new Set<string>();
  const emitLiveState = (key: string, state: LiveState | null) =>
    socketServer.to(`live_${key}`).emit('live:state', { key, state });
  const announceChange = (key: string, state: LiveState | null, projectId: number | null | undefined) => {
    emitLiveState(key, state);
    if (projectId) emitToProject(projectId, 'live:changed', { projectId });
  };
  socket.on('live:join', async (key: string) => {
    // Resume after F5: cancels the pending grace departure; the role (driver...) is kept.
    cancelLiveLeave(key, uid);
    // Idempotent re-join (internal navigation): simply re-emits the current state.
    if (joinedLives.has(key)) return emitLiveState(key, getLiveState(key));
    const role = await freshRole(socket);
    if (!role) return;
    const target = parseLiveKey(key);
    const projectId = await resolveLiveProject(key);
    if (!target || !projectId || !(await checkProjectAccess(uid, role, projectId))) return;
    const participant: LiveParticipant | null = await publicParticipant(uid);
    if (!participant) return;
    // Metadata resolved at creation (per-project LIVE badges) + dailies notification:
    // a live started on a playlist notifies the project's members (once).
    // The mirror decides whether the version must be resolved; the creation itself is settled under a lock
    // by `joinLive`, otherwise two replicas would notify twice.
    const meta: LiveSessionMeta =
      target.type === 'media' ? { projectId, mediaId: target.id } : { projectId, playlistId: target.id };
    if (!getLiveState(key) && target.type === 'media') {
      const media = await prisma.mediaObject.findUnique({
        where: { id: target.id },
        select: { versionId: true },
      });
      if (media) meta.versionId = media.versionId;
    }
    await socket.join(`live_${key}`);
    joinedLives.add(key);
    const { state, created } = await joinLive(key, participant, meta);
    announceChange(key, state, projectId);
    if (created && target.type === 'playlist')
      void notifyPlaylistLiveStarted(target.id, { id: uid, displayName: participant.displayName });
  });
  socket.on('live:leave', (key: string) => {
    if (!joinedLives.delete(key)) return;
    void socket.leave(`live_${key}`);
    cancelLiveLeave(key, uid);
    const pid = getLiveProjectId(key);
    void leaveLive(key, uid).then((state) => announceChange(key, state, pid));
  });
  socket.on('live:sync', (key: string, payload: unknown) => {
    if (!joinedLives.has(key) || !canDriveLive(key, uid)) return;
    // An interaction (`action: true`) from a driver/co-driver makes them the driver;
    // periodic broadcast (without action) is relayed only from the current driver.
    const isAction = !!(payload as { action?: boolean } | null)?.action;
    // Taking control is written to Redis, but the relay does not wait for it: a round trip per sync
    // frame (up to 30 Hz) would make playback stutter.
    if (isAction) {
      void claimDrive(key, uid).then((state) => {
        if (state) emitLiveState(key, state);
      });
    } else if (!isLiveDriver(key, uid)) return;
    socket.to(`live_${key}`).emit('live:sync', { key, payload });
  });
  socket.on('live:handoff', (key: string, toUserId: number) => {
    if (!joinedLives.has(key)) return;
    void handoffLive(key, uid, Number(toUserId)).then((state) => {
      if (state) emitLiveState(key, state);
    });
  });
  socket.on('live:cohost', (key: string, toUserId: number, isCoHost: boolean) => {
    if (!joinedLives.has(key)) return;
    void setCoHost(key, uid, Number(toUserId), !!isCoHost).then((state) => {
      if (state) emitLiveState(key, state);
    });
  });
  return () => {
    // Deferred live departure (grace): a F5 re-join before the deadline keeps its role.
    for (const key of joinedLives) {
      const pid = getLiveProjectId(key);
      scheduleLiveLeave(key, uid, (state) => announceChange(key, state, pid));
    }
    joinedLives.clear();
  };
}

/** Project rooms: the team's internal channel, joined and left by the client as it navigates. */
function registerProjectRooms(socket: AuthedSocket): void {
  // ⚠ A guest coming through a share link does NOT join `project_<id>`: that is the team's internal
  // channel. Emitting `comment:new` there with the enriched comment would reach everyone, including those
  // marked `isVisibleToClient: false`, the authors' identities and the presigned attachment URLs. The share
  // page listens to nothing on this channel; subscribing it would only leak the internal review in real time.
  socket.on('join_project', async (projectId: number) => {
    const pid = Number(projectId);
    if (!Number.isInteger(pid)) return;
    if (socket.shareProjectId) return;
    // This is where the demotion was playing out: the check read the role from the handshake, and
    // `resolveProjectAccess` grants global access to ADMIN as well as SUPERVISOR. A former supervisor could
    // therefore join any project from an open tab.
    if (!(await revalidateSocket(socket))) return socket.disconnect(true);
    if (socket.user && (await checkProjectAccess(socket.user.id, socket.user.role, pid))) {
      await socket.join(`project_${pid}`);
    }
  });

  /**
   * Leaves a project's room (D3).
   *
   * It was never left: after a day of browsing, a tab kept receiving the events of every project opened since
   * the morning, and invalidated caches that no longer concerned it.
   */
  socket.on('leave_project', async (projectId: number) => {
    const pid = Number(projectId);
    if (!Number.isInteger(pid)) return;
    await socket.leave(`project_${pid}`);
  });
}

// Tolerant emissions: no-op if Socket.io is not initialized (tests, scripts).
export const emitToUser = (userId: number, event: string, data: unknown): void => {
  io?.to(`user_${userId}`).emit(event, data);
};

/**
 * Are we in a process without a socket server?
 *
 * `io` is only set by `initSocket`, called at HTTP server startup. In the worker process it stays `undefined`,
 * and any emission there is a silent no-op: this is what made real time mute after a ShotGrid synchronization.
 * Callers that may run on either side use it to go through the Redis channel instead.
 */
export const isWorkerProcess = (): boolean => io === undefined;

export const emitToProject = (projectId: number, event: string, data: unknown): void => {
  io?.to(`project_${projectId}`).emit(event, data);
};

/** Viewers' room of a review (joined via `join_review`). */
export const emitToReview = (mediaId: number, event: string, data: unknown): void => {
  io?.to(`review_${mediaId}`).emit(event, data);
};
