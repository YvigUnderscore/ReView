// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { emitToUser } from './SocketService';
import { sendToUser } from './PushService';
import { isValidDiscordWebhook } from '../lib/sanitize';
import { logger } from '../lib/logger';

/**
 * Crée une notification in-app et la pousse en temps réel à l'utilisateur ciblé.
 */
export async function notify(params: {
  userId: number;
  type: string;
  content: string;
  projectId?: number | null;
  referenceId?: number | null;
}): Promise<void> {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      content: params.content,
      projectId: params.projectId ?? null,
      referenceId: params.referenceId ?? null,
    },
  });
  emitToUser(params.userId, 'notification:new', notification);
  // Web Push (42.B — №66) : notification navigateur hors-onglet (si l'utilisateur s'est abonné).
  const url = params.projectId ? `/projects/${params.projectId}` : '/';
  sendToUser(params.userId, { title: 'ReView', body: params.content, url });
}

/**
 * Review live démarrée sur une playlist (dailies, Phase 33 retours) : notifie tous les
 * membres du projet (sauf l'initiateur) — la notification (type LIVE) mène à la session.
 */
export async function notifyPlaylistLiveStarted(
  playlistId: number,
  starter: { id: number; displayName: string },
): Promise<void> {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    select: {
      name: true,
      projectId: true,
      project: { select: { memberships: { select: { userId: true } } } },
    },
  });
  if (!playlist) return;
  const targets = new Set(playlist.project.memberships.map((m) => m.userId));
  targets.delete(starter.id);
  await Promise.all(
    [...targets].map((userId) =>
      notify({
        userId,
        type: 'LIVE',
        content: `${starter.displayName} a démarré une review live sur la playlist « ${playlist.name} »`,
        projectId: playlist.projectId,
        referenceId: playlistId,
      }),
    ),
  );
}

/**
 * Envoie un message au webhook Discord du studio (si configuré et valide).
 * Tolérant aux erreurs : un échec Discord ne doit jamais casser le flux applicatif.
 */
export async function sendDiscord(content: string): Promise<void> {
  try {
    const studio = await prisma.studio.findFirst({ select: { discordWebhookUrl: true } });
    const url = studio?.discordWebhookUrl;
    if (!url || !isValidDiscordWebhook(url)) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    logger.warn({ err }, '[Discord] envoi échoué');
  }
}
