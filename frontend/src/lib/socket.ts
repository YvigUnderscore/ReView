import { io, type Socket } from 'socket.io-client';
import { getToken } from './apiClient';

/**
 * Client Socket.io partagé (singleton). Authentifié par le JWT courant.
 * Réutilisé par la présence, le temps réel des commentaires, etc.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io('/', {
    query: { token: getToken() ?? '' },
    transports: ['websocket'],
    autoConnect: true,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Signale une activité utilisateur au serveur (met à jour lastSeenAt). */
export function emitActivity(): void {
  socket?.emit('activity');
}
