import { Server as SocketServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
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
  type LiveParticipant,
} from './LiveSessionService';

let io: SocketServer | undefined;

interface AuthedSocket extends Socket {
  user?: { id: number; email: string; role: import('@prisma/client').Role };
  shareProjectId?: number;
}

/**
 * Initialise Socket.io avec auth JWT (utilisateur) ou token de partage (ShareLink → invité).
 */
export const initSocket = (server: HttpServer): SocketServer => {
  io = new SocketServer(server, {
    cors: { origin: env.CORS_ORIGIN, methods: ['GET', 'POST'] },
  });

  // Diffusion de la liste des utilisateurs en ligne à tous les clients connectés.
  setPresenceBroadcaster((onlineUserIds) => io?.emit('presence:update', { onlineUserIds }));

  io.use(async (socket: AuthedSocket, next) => {
    const token = socket.handshake.query?.token;
    if (typeof token !== 'string') return next(new Error('Authentication error'));

    const payload = verifyToken(token);
    if (payload) {
      socket.user = { id: payload.id, email: payload.email, role: payload.role };
      return next();
    }

    // Sinon : token de partage client (ShareLink)
    const share = await prisma.shareLink.findUnique({ where: { token } });
    if (share && !share.revoked && (!share.expiresAt || share.expiresAt > new Date())) {
      socket.shareProjectId = share.projectId;
      return next();
    }
    return next(new Error('Authentication error'));
  });

  io.on('connection', (socket: AuthedSocket) => {
    if (socket.user) {
      socket.join(`user_${socket.user.id}`);
      const uid = socket.user.id;
      void markOnline(uid);
      // Activité : le client émet `activity` (interactions) → rafraîchit lastSeenAt.
      socket.on('activity', () => void touch(uid));

      // Présence par review : avatars « en train de regarder » (backlog P2 10.G).
      // RBAC revérifié au join ; identité publique résolue une fois par entrée.
      const joinedReviews = new Set<number>();
      const emitViewers = (mediaId: number) =>
        io?.to(`review_${mediaId}`).emit('review:presence', {
          mediaId,
          viewers: getReviewViewers(mediaId),
        });
      socket.on('join_review', async (mediaId: number) => {
        const mid = Number(mediaId);
        if (!Number.isInteger(mid)) return;
        if (joinedReviews.has(mid)) return emitViewers(mid);
        const projectId = await resolveProjectIdForMedia(mid);
        if (!projectId || !(await checkProjectAccess(uid, socket.user!.role, projectId))) return;
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
        if (!raw) return;
        const pub = await toPublicUser(raw);
        socket.join(`review_${mid}`);
        joinedReviews.add(mid);
        joinReview(mid, {
          id: pub.id,
          displayName: pub.displayName,
          initials: pub.initials,
          avatarUrl: pub.avatarUrl,
        });
        emitViewers(mid);
      });
      socket.on('leave_review', (mediaId: number) => {
        const mid = Number(mediaId);
        if (!joinedReviews.delete(mid)) return;
        socket.leave(`review_${mid}`);
        leaveReview(mid, uid);
        emitViewers(mid);
      });

      // ── Salle de review live (33.B) : rooms `live_<key>`, pilote + spectateurs. ──
      // RBAC revérifié au join (média ou playlist → projet) ; `live:sync` n'est relayé
      // que depuis le pilote, payload opaque (playhead/pause/média courant/caméra).
      const joinedLives = new Set<string>();
      const emitLiveState = (key: string, state: ReturnType<typeof joinLive> | null) =>
        io?.to(`live_${key}`).emit('live:state', { key, state });
      const resolveLiveProject = async (key: string): Promise<number | null> => {
        const target = parseLiveKey(key);
        if (!target) return null;
        if (target.type === 'media') return resolveProjectIdForMedia(target.id);
        const playlist = await prisma.playlist.findUnique({
          where: { id: target.id },
          select: { projectId: true },
        });
        return playlist?.projectId ?? null;
      };
      socket.on('live:join', async (key: string) => {
        // Re-join idempotent (navigation interne) : ré-émet simplement l'état courant.
        if (joinedLives.has(key)) return emitLiveState(key, getLiveState(key));
        const projectId = await resolveLiveProject(key);
        if (!projectId || !(await checkProjectAccess(uid, socket.user!.role, projectId))) return;
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
        if (!raw) return;
        const pub = await toPublicUser(raw);
        const participant: LiveParticipant = {
          id: pub.id,
          displayName: pub.displayName,
          initials: pub.initials,
          avatarUrl: pub.avatarUrl,
        };
        socket.join(`live_${key}`);
        joinedLives.add(key);
        emitLiveState(key, joinLive(key, participant));
      });
      socket.on('live:leave', (key: string) => {
        if (!joinedLives.delete(key)) return;
        socket.leave(`live_${key}`);
        emitLiveState(key, leaveLive(key, uid));
      });
      socket.on('live:sync', (key: string, payload: unknown) => {
        if (!joinedLives.has(key) || !canDriveLive(key, uid)) return;
        // Interaction (`action: true`) d'un pilote/co-pilote → il devient le driver ;
        // la diffusion périodique (sans action) n'est relayée que du driver courant.
        const isAction = !!(payload as { action?: boolean } | null)?.action;
        if (isAction) {
          const state = claimDrive(key, uid);
          if (state) emitLiveState(key, state);
        } else if (!isLiveDriver(key, uid)) return;
        socket.to(`live_${key}`).emit('live:sync', { key, payload });
      });
      socket.on('live:handoff', (key: string, toUserId: number) => {
        if (!joinedLives.has(key)) return;
        const state = handoffLive(key, uid, Number(toUserId));
        if (state) emitLiveState(key, state);
      });
      socket.on('live:cohost', (key: string, toUserId: number, isCoHost: boolean) => {
        if (!joinedLives.has(key)) return;
        const state = setCoHost(key, uid, Number(toUserId), !!isCoHost);
        if (state) emitLiveState(key, state);
      });

      socket.on('disconnect', () => {
        void markOffline(uid);
        for (const mid of joinedReviews) {
          leaveReview(mid, uid);
          emitViewers(mid);
        }
        joinedReviews.clear();
        for (const key of joinedLives) emitLiveState(key, leaveLive(key, uid));
        joinedLives.clear();
      });
    }
    if (socket.shareProjectId) socket.join(`project_${socket.shareProjectId}`);

    socket.on('join_project', async (projectId: number) => {
      const pid = Number(projectId);
      if (!Number.isInteger(pid)) return;
      if (socket.shareProjectId) {
        if (pid === socket.shareProjectId) socket.join(`project_${pid}`);
        return;
      }
      if (socket.user && (await checkProjectAccess(socket.user.id, socket.user.role, pid))) {
        socket.join(`project_${pid}`);
      }
    });
  });

  return io;
};

// Émissions tolérantes : no-op si Socket.io n'est pas initialisé (tests, scripts).
export const emitToUser = (userId: number, event: string, data: unknown): void => {
  io?.to(`user_${userId}`).emit(event, data);
};

export const emitToProject = (projectId: number, event: string, data: unknown): void => {
  io?.to(`project_${projectId}`).emit(event, data);
};
