// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getDefaultLocale, resolveUserLocale } from '../lib/settings';
import { t, type MessageKey, type TParams } from '../i18n';
import { emitToUser } from './SocketService';
import { sendToUser } from './PushService';
import { isValidDiscordWebhook } from '../lib/sanitize';
import { safeFetch } from '../lib/safeFetch';
import { logger } from '../lib/logger';
import { NOTIFICATION_TYPE, channelEnabled, type NotificationKind } from '../lib/notificationKinds';

/**
 * Creates an in-app notification and pushes it in real time to the targeted user.
 *
 * The sentence is a **key and its parameters** (D2), not text: it used to be written in French in the
 * database, then served as is to everyone — including in the browser notification,
 * which escaped any catalogue. `content` is still written, in English, for readers who have not yet reloaded
 * the interface and for earlier rows.
 *
 * The `kind` is the sole input: the `type` served to the browser is derived from it (registry
 * `lib/notificationKinds`), and it is what decides whether the recipient still wants this
 * event — in the panel, and in their browser. A refused row is not written at all: a panel filled with what
 * one asked not to see any more remains a panel one no longer opens.
 */
export async function notify(params: {
  userId: number;
  kind: NotificationKind;
  messageKey: MessageKey;
  params?: TParams;
  projectId?: number | null;
  referenceId?: number | null;
}): Promise<void> {
  // A single read of the recipient for the two decisions that concern them: their per-event settings and
  // their language. `resolveUserLocale` previously received the user's NUMBER
  // instead of their preferences: it obviously found no `locale` there, fell back on the studio default, and
  // the browser notification went out in the studio's language whatever its recipient had chosen.
  const recipient = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { preferences: true },
  });
  if (!recipient) return;
  const preferences = recipient.preferences;
  if (!channelEnabled(preferences, params.kind, 'inApp')) return;

  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: NOTIFICATION_TYPE[params.kind],
      messageKey: params.messageKey,
      params: (params.params ?? null) as Prisma.InputJsonValue,
      content: t('en', params.messageKey, params.params),
      projectId: params.projectId ?? null,
      referenceId: params.referenceId ?? null,
    },
  });
  emitToUser(params.userId, 'notification:new', notification);
  // Web Push (42.B — #66): off-tab browser notification (if the user subscribed). It leaves the application:
  // it is here, and nowhere else, that it must be rendered in the recipient's language.
  if (!channelEnabled(preferences, params.kind, 'push')) return;
  const locale = await resolveUserLocale(preferences);
  const url = params.projectId ? `/projects/${params.projectId}` : '/';
  sendToUser(params.userId, { title: 'ReView', body: t(locale, params.messageKey, params.params), url });
}

/**
 * Live review started on a playlist (dailies, Phase 33 feedback): notifies all project members (except the
 * initiator) — the notification (type LIVE) leads to the session.
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
        kind: 'live',
        messageKey: 'notification.liveStarted',
        params: { name: starter.displayName, playlist: playlist.name },
        projectId: playlist.projectId,
        referenceId: playlistId,
      }),
    ),
  );
}

/** Discord answers within a few hundred milliseconds; beyond that, the notification is lost. */
const DISCORD_TIMEOUT_MS = 5000;
/** Discord's response fits in a few hundred bytes; we will not read more of it. */
const DISCORD_MAX_BYTES = 64 * 1024;

/**
 * Sends a message to the studio's Discord webhook (if configured and valid).
 * Error-tolerant: a Discord failure must never break the application flow.
 *
 * The sentence is a **key** and not text, for the same reason as in `notifyChat`: what goes to a team channel
 * leaves the application and so escaped any catalogue — a hard-coded message stayed French there whatever the
 * studio's language. A channel is collective: it is rendered in the studio's language, not in a reader's.
 *
 * The call goes through `safeFetch` and not `fetch`: it had **no timeout at all**. A relay that accepts the
 * connection and then goes silent held a socket and the message context indefinitely,
 * once per notification, without ever reaching the `catch`. `safeFetch` additionally brings the guard on the
 * resolved address and the refusal to follow a redirect — the `isValidDiscordWebhook`
 * allow-list only checks the starting URL.
 */
export async function sendDiscord(key: MessageKey, params?: TParams): Promise<void> {
  try {
    const studio = await prisma.studio.findFirst({ select: { discordWebhookUrl: true } });
    const url = studio?.discordWebhookUrl;
    if (!url || !isValidDiscordWebhook(url)) return;
    const content = t(await getDefaultLocale(), key, params);
    const res = await safeFetch(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      },
      { timeoutMs: DISCORD_TIMEOUT_MS, maxRedirects: 0, maxBytes: DISCORD_MAX_BYTES },
    );
    // A 4xx (webhook deleted, malformed payload) remained completely silent: nothing distinguished a
    // delivered notification from a lost one.
    if (!res.ok) logger.warn({ status: res.status }, '[Discord] webhook refused');
  } catch (err) {
    logger.warn({ err }, '[Discord] send failed');
  }
}
