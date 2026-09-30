// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { io, type Socket } from 'socket.io-client';
import { getToken } from './apiClient';

/**
 * Client Socket.io partagé (singleton). Authentifié par le JWT courant.
 * Réutilisé par la présence, le temps réel des commentaires, etc.
 *
 * Le jeton voyage dans le `auth` du handshake et non dans la query string : la query
 * string est journalisée par le frontal (nginx) et par tout proxy intermédiaire, le
 * `auth` non. Sous forme de rappel, socket.io le relit à **chaque** (re)connexion : un
 * jeton renouvelé entre-temps est donc pris en compte sans intervention.
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
 * Ferme le canal temps réel et oublie l'instance.
 *
 * Appelé à chaque changement de compte : sur un poste de salle de review partagé, un
 * socket laissé ouvert continuerait de servir les notifications et les messages privés du
 * précédent utilisateur (le serveur n'authentifie qu'au handshake). La prochaine demande
 * de socket en ouvre un neuf, avec le jeton du nouvel arrivant.
 */
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Signale une activité utilisateur au serveur (met à jour lastSeenAt). */
export function emitActivity(): void {
  socket?.emit('activity');
}
