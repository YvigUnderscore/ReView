import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { decryptSecret } from '../lib/crypto';
import { signWebhookPayload, type WebhookEvent } from '../lib/webhooks';
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

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ReView-Webhook/1.0',
        'X-ReView-Event': event,
        'X-ReView-Timestamp': timestamp,
        'X-ReView-Signature': signWebhookPayload(secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    await record(res.status, res.ok ? null : `HTTP ${res.status}`);
    if (!res.ok) throw new Error(`Webhook ${webhookId} → HTTP ${res.status}`);
  } catch (err) {
    if (!(err instanceof Error && err.message.startsWith('Webhook '))) {
      await record(null, (err as Error).message?.slice(0, 300) ?? 'erreur réseau');
    }
    throw err;
  }
}
