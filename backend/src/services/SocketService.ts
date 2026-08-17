// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Server as SocketServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyToken } from '../lib/jwt';
import { isSessionActive } from '../lib/sessions';
import { shareState, verifyShareSession } from '../lib/shareAccess';
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
  getLiveProjectId,
  scheduleLiveLeave,
  cancelLiveLeave,
  type LiveParticipant,
  type LiveSessionMeta,
} from './LiveSessionService';
import { notifyPlaylistLiveStarted } from './NotificationService';
import { subscribeWorkerEvents } from '../lib/workerEvents';

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
    // Même résolution qu'en HTTP (cf. app.ts) : une liste séparée par des virgules doit
    // donner N origines, pas une seule chaîne qui ne matcherait jamais.
    cors: {
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      methods: ['GET', 'POST'],
    },
  });

  // Diffusion de la liste des utilisateurs en ligne à tous les clients connectés.
  setPresenceBroadcaster((onlineUserIds) => io?.emit('presence:update', { onlineUserIds }));

  // Événements du worker FFmpeg (34.F, redis pub/sub) : échelle HLS progressive —
  // la review recharge son master (nouvelles qualités), le projet rafraîchit ses cartes.
  subscribeWorkerEvents((e) => {
    if (e.type === 'markers') {
      // Scene detection (34.H) : marqueurs « Plan n » posés → la review recharge sa liste.
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

  const authenticateSocket = async (socket: AuthedSocket, next: (err?: Error) => void): Promise<void> => {
    const token = socket.handshake.query?.token;
    if (typeof token !== 'string') return next(new Error('Authentication error'));

    // Mêmes garanties que `middleware/auth` côté HTTP — un socket ne doit pas être une
    // porte dérobée. Tous les jetons de l'app sont signés avec le même JWT_SECRET : seul
    // un jeton d'accès (sans `kind`) est recevable. Accepter un `kind: '2fa'` reviendrait
    // à contourner le second facteur, un `refresh`/`share`/`oidc` à confondre les usages.
    const payload = verifyToken(token);
    if (payload) {
      if (payload.kind !== undefined || typeof payload.id !== 'number') {
        return next(new Error('Authentication error'));
      }
      // Session révoquée (36.B) : la déconnexion doit aussi fermer le canal temps réel.
      if (payload.sid && !(await isSessionActive(payload.sid))) {
        return next(new Error('Authentication error'));
      }
      // Zombie-token check + rôle courant relu en base (un rôle rétrogradé prend effet).
      const dbUser = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { id: true, email: true, role: true },
      });
      if (!dbUser) return next(new Error('Authentication error'));
      socket.user = dbUser;
      return next();
    }

    // Sinon : token de partage client (ShareLink) — mêmes règles que les routes /api/client
    // (révocation, expiration ET limite de vues atteinte). Un lien protégé par mot de passe
    // exige en plus la session de partage émise après déverrouillage : le token seul est
    // dans l'URL, l'accepter ferait du mot de passe une formalité.
    const share = await prisma.shareLink.findUnique({ where: { token } });
    if (share && shareState(share) === 'ok') {
      if (share.passwordHash) {
        const shareAuth = socket.handshake.query?.shareAuth;
        if (typeof shareAuth !== 'string' || !verifyShareSession(shareAuth, share.id)) {
          return next(new Error('Authentication error'));
        }
      }
      socket.shareProjectId = share.projectId;
      return next();
    }
    return next(new Error('Authentication error'));
  };

  // socket.io attend un middleware synchrone : on détache la vérification asynchrone,
  // `next` étant appelé dans tous les chemins. Le `catch` ferme la porte si la
  // vérification échoue elle-même — sans lui, le socket resterait suspendu.
  io.use((socket: AuthedSocket, next) => {
    void authenticateSocket(socket, next).catch(() => next(new Error('Authentication error')));
  });

  io.on('connection', (socket: AuthedSocket) => {
    if (socket.user) {
      // `join`/`leave` rendent une promesse avec les adapters distribués ; l'adapter en
      // mémoire résout de façon synchrone — d'où le `void` sur les appels hors contexte async.
      void socket.join(`user_${socket.user.id}`);
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
        await socket.join(`review_${mid}`);
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
        void socket.leave(`review_${mid}`);
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
        // Reprise après F5 : annule le départ en grâce, le rôle (pilote…) est conservé.
        cancelLiveLeave(key, uid);
        // Re-join idempotent (navigation interne) : ré-émet simplement l'état courant.
        if (joinedLives.has(key)) return emitLiveState(key, getLiveState(key));
        const target = parseLiveKey(key);
        const projectId = await resolveLiveProject(key);
        if (!target || !projectId || !(await checkProjectAccess(uid, socket.user!.role, projectId))) return;
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
        // Méta résolue à la création (badges LIVE par projet) + notification dailies :
        // un live démarré sur une playlist notifie les membres du projet (une fois).
        const created = !getLiveState(key);
        const meta: LiveSessionMeta =
          target.type === 'media' ? { projectId, mediaId: target.id } : { projectId, playlistId: target.id };
        if (created && target.type === 'media') {
          const media = await prisma.mediaObject.findUnique({
            where: { id: target.id },
            select: { versionId: true },
          });
          if (media) meta.versionId = media.versionId;
        }
        await socket.join(`live_${key}`);
        joinedLives.add(key);
        emitLiveState(key, joinLive(key, participant, meta));
        emitToProject(projectId, 'live:changed', { projectId });
        if (created && target.type === 'playlist')
          void notifyPlaylistLiveStarted(target.id, { id: uid, displayName: pub.displayName });
      });
      socket.on('live:leave', (key: string) => {
        if (!joinedLives.delete(key)) return;
        void socket.leave(`live_${key}`);
        cancelLiveLeave(key, uid);
        const pid = getLiveProjectId(key);
        emitLiveState(key, leaveLive(key, uid));
        if (pid) emitToProject(pid, 'live:changed', { projectId: pid });
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
        // Départ live différé (grâce) : un F5 re-join avant l'échéance et garde son rôle.
        for (const key of joinedLives) {
          const pid = getLiveProjectId(key);
          scheduleLiveLeave(key, uid, (state) => {
            emitLiveState(key, state);
            if (pid) emitToProject(pid, 'live:changed', { projectId: pid });
          });
        }
        joinedLives.clear();
      });
    }
    // ⚠ Un invité par lien de partage ne rejoint PAS `project_<id>` : c'est le canal
    // interne de l'équipe. On y diffuse `comment:new` avec le commentaire enrichi —
    // y compris ceux marqués `isVisibleToClient: false`, l'identité des auteurs et les
    // URLs présignées des pièces jointes. La page de partage n'écoute rien sur ce canal ;
    // l'y abonner ne servait qu'à faire fuiter la review interne en temps réel.
    socket.on('join_project', async (projectId: number) => {
      const pid = Number(projectId);
      if (!Number.isInteger(pid)) return;
      if (socket.shareProjectId) return;
      if (socket.user && (await checkProjectAccess(socket.user.id, socket.user.role, pid))) {
        await socket.join(`project_${pid}`);
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

/** Room des spectateurs d'une review (jointe via `join_review`). */
export const emitToReview = (mediaId: number, event: string, data: unknown): void => {
  io?.to(`review_${mediaId}`).emit(event, data);
};
