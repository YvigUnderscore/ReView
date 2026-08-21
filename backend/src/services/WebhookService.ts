// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { decryptSecret } from '../lib/crypto';
import { signWebhookPayload, type WebhookEvent } from '../lib/webhooks';
import { safeFetch } from '../lib/safeFetch';
import { enqueueWebhookDelivery } from './JobService';

/**
 * Webhooks sortants (36.D) : `emitWebhookEvent` (fire-and-forget, appelé par les
 * services métier) enfile un job BullMQ par webhook actif abonné ; `deliver` (worker)
 * fait le POST signé HMAC et journalise le dernier statut sur le webhook.
 */

export function emitWebhookEvent(event: WebhookEvent, payload: Record<string, unknown>): void {
  void (async () => {
    const hooks = await prisma.webhook.findMany({
      where: { active: true, events: { has: event } },
      select: { id: true },
    });
    for (const h of hooks) {
      await enqueueWebhookDelivery({ webhookId: h.id, event, payload });
    }
  })().catch((err) => logger.warn({ err }, `[webhooks] émission ${event} échouée`));
}

const DELIVERY_TIMEOUT_MS = 10_000;

/** Livraison effective (worker) — lève en cas d'échec pour déclencher le retry BullMQ. */
export async function deliver(
  webhookId: number,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const hook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!hook || !hook.active) return; // désactivé/supprimé entre-temps : rien à faire
  const secret = decryptSecret(hook.secret) ?? '';
  const timestamp = String(Date.now());
  const body = JSON.stringify({ event, timestamp: Number(timestamp), data: payload });

  const record = (status: number | null, error: string | null) =>
    prisma.webhook
      .update({
        where: { id: webhookId },
        data: { lastStatus: status, lastError: error, lastDeliveryAt: new Date() },
      })
      .catch(() => undefined);

  // Anti-SSRF : le worker tourne DANS le réseau interne (MinIO, Redis, Postgres y sont
  // joignables sans authentification réseau). Une URL de webhook est saisie par un admin de
  // l'app — ce qui ne lui donne pas pour autant la main sur ce réseau. `safeFetch` résout le
  // nom AVANT la requête (un nom public peut pointer vers 127.0.0.1 ou 169.254.169.254) et
  // ne suit aucune redirection (elle rejouerait le POST signé vers une cible non vérifiée).
  try {
    const res = await safeFetch(
      hook.url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ReView-Webhook/1.0',
          'X-ReView-Event': event,
          'X-ReView-Timestamp': timestamp,
          'X-ReView-Signature': signWebhookPayload(secret, timestamp, body),
        },
        body,
      },
      { timeoutMs: DELIVERY_TIMEOUT_MS },
    );
    await record(res.status, res.ok ? null : `HTTP ${res.status}`);
    if (!res.ok) throw new Error(`Webhook ${webhookId} → HTTP ${res.status}`);
  } catch (err) {
    if (!(err instanceof Error && err.message.startsWith('Webhook '))) {
      await record(null, (err as Error).message?.slice(0, 300) ?? 'erreur réseau');
    }
    throw err;
  }
}
