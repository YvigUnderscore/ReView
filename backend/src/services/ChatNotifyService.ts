// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { isValidDiscordWebhook, isValidSlackWebhook } from '../lib/sanitize';

/**
 * Notifications de messagerie d'équipe (42.B — №67) : poste un message aux webhooks
 * entrants Discord (`Studio.discordWebhookUrl`) et Slack (réglage `slack_webhook_url`)
 * quand ils sont configurés. Fire-and-forget : n'interrompt jamais le flux métier.
 */
const SLACK_SETTING_KEY = 'slack_webhook_url';

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Poste `text` aux messageries configurées (Discord + Slack). Fire-and-forget : les appelants
 * ignorent la promesse retournée, qui se résout toujours (les erreurs sont journalisées).
 */
export function notifyChat(text: string): Promise<void> {
  return (async () => {
    const [studio, slack] = await Promise.all([
      prisma.studio.findFirst({ select: { discordWebhookUrl: true } }),
      prisma.setting.findUnique({ where: { key: SLACK_SETTING_KEY } }),
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
