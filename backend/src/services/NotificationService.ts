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
 * Crée une notification in-app et la pousse en temps réel à l'utilisateur ciblé.
 *
 * La phrase est une **clé et ses paramètres** (D2), pas du texte : elle était écrite en
 * français en base, puis servie telle quelle à tout le monde — jusque dans la notification
 * navigateur, qui échappait à tout catalogue. `content` reste écrit, en anglais, pour les
 * lecteurs qui n'ont pas encore rechargé l'interface et pour les lignes antérieures.
 *
 * Le `kind` est l'unique entrée : le `type` servi au navigateur s'en déduit (registre
 * `lib/notificationKinds`), et c'est lui qui décide si le destinataire veut encore de cet
 * événement — dans le panneau, et dans son navigateur. Une ligne refusée n'est pas écrite
 * du tout : un panneau qui se remplit de ce qu'on a demandé à ne plus voir reste un
 * panneau qu'on n'ouvre plus.
 */
export async function notify(params: {
  userId: number;
  kind: NotificationKind;
  messageKey: MessageKey;
  params?: TParams;
  projectId?: number | null;
  referenceId?: number | null;
}): Promise<void> {
  // Une seule lecture du destinataire pour les deux décisions qui le concernent : ses
  // réglages par événement et sa langue. `resolveUserLocale` recevait auparavant le NUMÉRO
  // de l'utilisateur au lieu de ses préférences : elle n'y trouvait évidemment pas de
  // `locale`, retombait sur le défaut du studio, et la notification navigateur partait
  // dans la langue du studio quoi qu'ait choisi son destinataire.
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
  // Web Push (42.B — №66) : notification navigateur hors-onglet (si l'utilisateur s'est
  // abonné). Elle sort de l'application : c'est ici, et nulle part ailleurs, qu'il faut
  // la rendre dans la langue du destinataire.
  if (!channelEnabled(preferences, params.kind, 'push')) return;
  const locale = await resolveUserLocale(preferences);
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
        kind: 'live',
        messageKey: 'notification.liveStarted',
        params: { name: starter.displayName, playlist: playlist.name },
        projectId: playlist.projectId,
        referenceId: playlistId,
      }),
    ),
  );
}

/** Discord répond en quelques centaines de millisecondes ; au-delà, la notification est perdue. */
const DISCORD_TIMEOUT_MS = 5000;
/** La réponse de Discord tient en quelques centaines d'octets ; on ne lui en lira pas plus. */
const DISCORD_MAX_BYTES = 64 * 1024;

/**
 * Envoie un message au webhook Discord du studio (si configuré et valide).
 * Tolérant aux erreurs : un échec Discord ne doit jamais casser le flux applicatif.
 *
 * La phrase est une **clé** et non du texte, pour la même raison que dans `notifyChat` :
 * ce qui part vers un canal d'équipe sort de l'application et échappait donc à tout
 * catalogue — un message écrit en dur y restait français quelle que soit la langue du
 * studio. Un canal est collectif : il se rend dans la langue du studio, pas dans celle
 * d'un lecteur.
 *
 * L'appel passe par `safeFetch` et non par `fetch` : il n'avait **aucun délai d'attente**.
 * Un relais qui accepte la connexion puis se tait retenait indéfiniment un socket et le
 * contexte du message, une fois par notification, sans jamais atteindre le `catch`.
 * `safeFetch` apporte en prime la garde sur l'adresse résolue et le refus de suivre une
 * redirection — l'allow-list `isValidDiscordWebhook` ne contrôle que l'URL de départ.
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
    // Un 4xx (webhook supprimé, charge malformée) restait totalement muet : rien ne
    // distinguait une notification remise d'une notification perdue.
    if (!res.ok) logger.warn({ status: res.status }, '[Discord] webhook refusé');
  } catch (err) {
    logger.warn({ err }, '[Discord] envoi échoué');
  }
}
