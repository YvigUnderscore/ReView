// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { isValidDiscordWebhook, isValidSlackWebhook } from '../lib/sanitize';
import { safeFetch } from '../lib/safeFetch';
import { getDefaultLocale } from '../lib/settings';
import { t, type MessageKey, type TParams } from '../i18n';

/**
 * Notifications de messagerie d'équipe (42.B — №67) : poste un message aux webhooks
 * entrants Discord (`Studio.discordWebhookUrl`) et Slack (réglage `slack_webhook_url`)
 * quand ils sont configurés. Fire-and-forget : n'interrompt jamais le flux métier.
 *
 * Deux règles du projet se rejoignent ici, et manquaient toutes les deux :
 *
 * 1. **La phrase est une clé.** Trois messages partaient d'ici en français écrit en dur —
 *    hors de tout catalogue, donc hors de tout contrôle : un studio japonais lisait
 *    « Décision « approved » sur la version v003 » dans son canal. Le texte est désormais
 *    rendu dans la langue **du studio** (`getDefaultLocale`), la seule qui ait un sens pour
 *    un canal collectif : personne n'a de langue propre dans un salon Slack.
 * 2. **Aucun `fetch` nu.** L'URL vient de l'administration : elle vaut capacité d'émettre
 *    une requête depuis le réseau applicatif, où MinIO, Redis, Postgres et le service de
 *    métadonnées cloud répondent sans authentification. `safeFetch` contrôle l'adresse
 *    RÉSOLUE et refuse de suivre une redirection — les allow-lists `isValid*Webhook` ne
 *    contrôlent, elles, que l'URL de départ.
 */
const SLACK_SETTING_KEY = 'slack_webhook_url';

/** Une messagerie répond en quelques centaines de millisecondes ; au-delà, c'est perdu. */
const CHAT_TIMEOUT_MS = 5000;
/** La réponse tient en quelques centaines d'octets ; on ne lui en lira pas plus. */
const CHAT_MAX_BYTES = 64 * 1024;

async function post(url: string, body: unknown): Promise<void> {
  const res = await safeFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { timeoutMs: CHAT_TIMEOUT_MS, maxRedirects: 0, maxBytes: CHAT_MAX_BYTES },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Phrase d'un message de messagerie, dans la langue du studio. Exportée pour les envois
 * qui ne visent qu'un canal (`sendDiscord`) : la règle « la phrase est une clé » ne doit
 * pas dépendre du nombre de destinataires.
 */
export async function chatText(key: MessageKey, params?: TParams): Promise<string> {
  return t(await getDefaultLocale(), key, params);
}

/**
 * Poste un message aux messageries configurées (Discord + Slack). Fire-and-forget : les
 * appelants ignorent la promesse retournée, qui se résout toujours (erreurs journalisées).
 */
export function notifyChat(key: MessageKey, params?: TParams): Promise<void> {
  return (async () => {
    const [studio, slack, text] = await Promise.all([
      prisma.studio.findFirst({ select: { discordWebhookUrl: true } }),
      prisma.setting.findUnique({ where: { key: SLACK_SETTING_KEY } }),
      chatText(key, params),
    ]);
    const targets: Promise<void>[] = [];
    const discord = studio?.discordWebhookUrl;
    if (isValidDiscordWebhook(discord)) targets.push(post(discord!, { content: text }));
    if (isValidSlackWebhook(slack?.value)) targets.push(post(slack!.value, { text }));
    if (targets.length === 0) return;
    const results = await Promise.allSettled(targets);
    for (const r of results) {
      if (r.status === 'rejected') logger.warn({ err: r.reason }, '[chat] envoi webhook échoué');
    }
  })().catch((err) => logger.warn({ err }, '[chat] notification échouée'));
}
