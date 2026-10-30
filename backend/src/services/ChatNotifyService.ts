// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { isValidDiscordWebhook, isValidSlackWebhook } from '../lib/sanitize';
import { safeFetch } from '../lib/safeFetch';
import { getDefaultLocale } from '../lib/settings';
import { t, type MessageKey, type TParams } from '../i18n';

/**
 * Team messaging notifications (42.B, #67): posts a message to the incoming webhooks of Discord
 * (`Studio.discordWebhookUrl`) and Slack (`slack_webhook_url` setting) when they are configured.
 * Fire-and-forget: never interrupts the business flow.
 *
 * Two project rules meet here, and both were missing:
 *
 * 1. **The sentence is a key.** Three messages left from here as hard-coded French, outside any catalogue and
 *    therefore outside any control: a Japanese studio read "Décision « approved » sur la version v003" in its
 * channel. The text is now rendered in the **studio's** language (`getDefaultLocale`), the only one that
 * makes
 *    sense for a collective channel: nobody has a personal language in a Slack room.
 * 2. **No bare `fetch`.** The URL comes from the administration: it amounts to the ability to emit a request
 * from
 *    the application network, where MinIO, Redis, Postgres and the cloud metadata service answer without
 * authentication. `safeFetch` checks the RESOLVED address and refuses to follow a redirect; the
 * `isValid*Webhook`
 *    allow-lists only check the starting URL.
 */
const SLACK_SETTING_KEY = 'slack_webhook_url';

/** A messaging service answers within a few hundred milliseconds; beyond that, the call is lost. */
const CHAT_TIMEOUT_MS = 5000;
/** The response fits in a few hundred bytes; we will not read more of it. */
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
 * Sentence of a messaging notification, in the studio's language. Exported for sends that target a single
 * channel (`sendDiscord`): the "the sentence is a key" rule must not depend on the number of recipients.
 */
export async function chatText(key: MessageKey, params?: TParams): Promise<string> {
  return t(await getDefaultLocale(), key, params);
}

/**
 * Posts a message to the configured messaging services (Discord + Slack). Fire-and-forget: callers ignore the
 * returned promise, which always resolves (errors are logged).
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
      if (r.status === 'rejected') logger.warn({ err: r.reason }, '[chat] webhook send failed');
    }
  })().catch((err) => logger.warn({ err }, '[chat] notification failed'));
}
