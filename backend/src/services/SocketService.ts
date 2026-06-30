import { Server as SocketServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { env } from '../config/env';
import { markOnline, markOffline, touch, setPresenceBroadcaster } from './PresenceService';

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
      socket.on('disconnect', () => void markOffline(uid));
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

export const getIo = (): SocketServer => {
  if (!io) throw new Error('Socket.io non initialisé');
  return io;
};

// Émissions tolérantes : no-op si Socket.io n'est pas initialisé (tests, scripts).
export const emitToUser = (userId: number, event: string, data: unknown): void => {
  io?.to(`user_${userId}`).emit(event, data);
};

export const emitToProject = (projectId: number, event: string, data: unknown): void => {
  io?.to(`project_${projectId}`).emit(event, data);
};
