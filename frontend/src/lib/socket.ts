// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { io, type Socket } from 'socket.io-client';
import { getToken } from './apiClient';

/**
 * Shared Socket.io client (singleton). Authenticated with the current JWT.
 * Reused by presence, real-time comments, etc.
 *
 * The token travels in the `auth` of the handshake, not in the query string: the query
 * string is logged by the front end (nginx) and by any intermediate proxy, the
 * `auth` is not. As a callback, socket.io rereads it on **each** (re)connection: a
 * token renewed in the meantime is therefore taken into account without intervention.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io('/', {
    auth: (cb: (data: object) => void) => cb({ token: getToken() ?? '' }),
    transports: ['websocket'],
    autoConnect: true,
  });
  return socket;
}

/**
 * Closes the real-time channel and forgets the instance.
 *
 * Called on each account change: on a shared review-room machine, a
 * socket left open would keep serving the notifications and private messages of the
 * previous user (the server only authenticates at the handshake). The next socket
 * request opens a new one, with the token of the new arrival.
 */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Signals user activity to the server (updates lastSeenAt). */
export function emitActivity(): void {
  socket?.emit('activity');
}
