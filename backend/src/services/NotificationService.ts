// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { resolveUserLocale } from '../lib/settings';
import { t, type MessageKey, type TParams } from '../i18n';
import { emitToUser } from './SocketService';
import { sendToUser } from './PushService';
import { isValidDiscordWebhook } from '../lib/sanitize';
import { logger } from '../lib/logger';

/**
 * Crée une notification in-app et la pousse en temps réel à l'utilisateur ciblé.
 *
 * La phrase est une **clé et ses paramètres** (D2), pas du texte : elle était écrite en
 * français en base, puis servie telle quelle à tout le monde — jusque dans la notification
 * navigateur, qui échappait à tout catalogue. `content` reste écrit, en anglais, pour les
 * lecteurs qui n'ont pas encore rechargé l'interface et pour les lignes antérieures.
 */
export async function notify(params: {
  userId: number;
  type: string;
  messageKey: MessageKey;
  params?: TParams;
  projectId?: number | null;
  referenceId?: number | null;
}): Promise<void> {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      messageKey: params.messageKey,
      params: (params.params ?? null) as Prisma.InputJsonValue,
      content: t('en', params.messageKey, params.params),
      projectId: params.projectId ?? null,
      referenceId: params.referenceId ?? null,
    },
  });
  emitToUser(params.userId, 'notification:new', notification);
  // Web Push (42.B — №66) : notification navigateur hors-onglet (si l'utilisateur s'est
  // abonné). Elle sort de l'application : c'est ici, et nulle part ailleurs, qu'il faut
  // la rendre dans la langue du destinataire.
  const locale = await resolveUserLocale(params.userId);
  const url = params.projectId ? `/projects/${params.projectId}` : '/';
  sendToUser(params.userId, { title: 'ReView', body: t(locale, params.messageKey, params.params), url });
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
        messageKey: 'notification.liveStarted',
        params: { name: starter.displayName, playlist: playlist.name },
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
