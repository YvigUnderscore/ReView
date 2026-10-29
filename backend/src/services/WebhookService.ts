// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { decryptSecret } from '../lib/crypto';
import { signWebhookPayload, type WebhookEvent } from '../lib/webhooks';
import { safeFetch } from '../lib/safeFetch';
import { enqueueWebhookDelivery } from './JobService';
import { ignoreFailure } from '../lib/ignoreFailure';

/**
 * Outgoing webhooks (36.D): `emitWebhookEvent` (fire-and-forget, called by the business services) enqueues a BullMQ job
 * per active subscribed webhook; `deliver` (worker) makes the HMAC-signed POST and logs the last status on the webhook.
 *
 * Two properties were added, changing what the studio can promise:
 *  - **scope**: a webhook attached to a project only receives that project's events, which finally makes it possible to
 *    hand a webhook to a client without opening the studio's catalogue to them;
 *  - **trace**: each delivery leaves a row (`WebhookDelivery`) with its identifier, its attempts, the HTTP status and an
 *    excerpt of the response. This identifier is carried by the `X-ReView-Delivery` header and the `id` field of the signed
 *    body: enough to deduplicate a retry on the consumer side, and to replay from administration.
 */

/** Kept response excerpt: enough to read an error message, not enough to store a page. */
export const RESPONSE_BODY_MAX = 1000;

/**
 * Read cap on the response. The body used not to be read; logging it requires bounding what a hostile recipient can make us
 * download. Beyond it, `safeFetch` cuts off and the excerpt is simply absent: the status, for its part, is still recorded.
 */
const RESPONSE_READ_MAX_BYTES = 64 * 1024;

/** Permanently lost deliveries, in a row, before automatic deactivation. */
export const FAILURE_STREAK_LIMIT = 5;

/**
 * Mirror of `webhookQueue.defaultJobOptions.attempts` (JobService). The value is repeated here because the worker does not
 * pass the BullMQ counter: it is attempt number `MAX_ATTEMPTS` that moves a delivery from "being retried" to "lost", and
 * therefore feeds the webhook's failure streak.
 */
const MAX_ATTEMPTS = 5;

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Reason recorded when the webhook's secret can no longer be decrypted (`lastError`, visible in the administration screen).
 * It does not describe a recipient outage: it is the instance's encryption key that has changed; see `lib/crypto`.
 */
export const SECRET_UNREADABLE_ERROR = 'WEBHOOK_SECRET_UNREADABLE';

/**
 * Envelope key carrying the delivery identifier through the queue.
 *
 * `WebhookJobData` (services/JobService) only carries `{ webhookId, event, payload }`, and `workers/webhook.worker` only
 * passes those three fields: the identifier therefore travels in the payload, under a reserved key that `deliver` removes
 * before signing. The body sent to the recipient carries no trace of it: the recipient receives the identifier in its normal
 * place, `id` at the root and the `X-ReView-Delivery` header.
 */
const DELIVERY_ENVELOPE_KEY = '_reviewDeliveryId';

export interface EmitOptions {
  /** Project concerned: `null` for a studio fact (no project webhook receives it). */
  projectId?: number | null;
  /** Row of the v1 journal that originated the emission, if it could be written. */
  apiEventId?: number | null;
}

/**
 * Subscribers to serve for a given event.
 *
 * A webhook without a project is a studio webhook: it receives everything, as before. A webhook attached to a project only
 * receives the events of THAT project, and an event belonging to no project never reaches it, since it cannot be asserted to
 * concern it.
 */
export function subscriberFilter(event: string, projectId: number | null): Prisma.WebhookWhereInput {
  return {
    active: true,
    events: { has: event },
    ...(projectId === null ? { projectId: null } : { OR: [{ projectId: null }, { projectId }] }),
  };
}

export function emitWebhookEvent(
  event: WebhookEvent,
  payload: Record<string, unknown>,
  opts: EmitOptions = {},
): void {
  const projectId = opts.projectId ?? null;
  void (async () => {
    const hooks = await prisma.webhook.findMany({
      where: subscriberFilter(event, projectId),
      select: { id: true },
    });
    for (const h of hooks) {
      await queueDelivery(h.id, event, payload, { apiEventId: opts.apiEventId ?? null });
    }
  })().catch((err) => logger.warn({ err }, `[webhooks] émission ${event} échouée`));
}

/**
 * Opens a journal line, then enqueues the job that will carry it.
 *
 * The order matters: the line exists before the first attempt, so a delivery that will fail five times is visible from the
 * first second instead of appearing, or not, at the end.
 */
export async function queueDelivery(
  webhookId: number,
  event: string,
  payload: Record<string, unknown>,
  opts: { apiEventId?: number | null; replayOfId?: number | null } = {},
): Promise<number> {
  const delivery = await prisma.webhookDelivery.create({
    data: {
      webhookId,
      event,
      payload: payload as unknown as Prisma.InputJsonObject,
      apiEventId: opts.apiEventId ?? null,
      replayOfId: opts.replayOfId ?? null,
    },
    select: { id: true },
  });
  await enqueueWebhookDelivery({
    webhookId,
    event,
    payload: { ...payload, [DELIVERY_ENVELOPE_KEY]: delivery.id },
  });
  return delivery.id;
}

/** Separates the delivery identifier from the payload actually sent to the recipient. */
export function unpackDelivery(payload: Record<string, unknown>): {
  deliveryId: number | null;
  data: Record<string, unknown>;
} {
  const { [DELIVERY_ENVELOPE_KEY]: raw, ...data } = payload;
  return { deliveryId: typeof raw === 'number' ? raw : null, data };
}

/** Effective delivery (worker): throws on failure to trigger the BullMQ retry. */
export async function deliver(
  webhookId: number,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const hook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!hook || !hook.active) return; // deactivated/deleted in the meantime: nothing to do
  const { deliveryId, data } = unpackDelivery(payload);
  const secret = decryptSecret(hook.secret);
  /**
   * Fail CLOSED on authenticity.
   *
   * The earlier `?? ''` signed with an EMPTY HMAC key: Node accepts it, and the delivery left with a perfectly well-formed
   * `X-ReView-Signature`, recomputable by anyone who knows the URL. That is worse than no signature at all, since the recipient
   * believes it verifies. So nothing is emitted, and the failure becomes readable.
   *
   * No `throw`: a retry will not repair a changed encryption key; it would only replay the same dead end five times. The webhook
   * stays active: the failure is one of configuration, not of the endpoint; repairing it must not require reactivating it by hand.
   */
  if (secret === null) {
    logger.error({ webhookId, deliveryId }, '[webhooks] secret illisible — livraison refusée');
    await recordFailure(webhookId, deliveryId, null, null, SECRET_UNREADABLE_ERROR);
    return;
  }
  const timestamp = String(Date.now());
  const body = JSON.stringify({ id: deliveryId, event, timestamp: Number(timestamp), data });

  // Anti-SSRF: the worker runs INSIDE the internal network (MinIO, Redis, Postgres are reachable there without network
  // authentication). A webhook URL is entered by an app admin, which does not give them control of that network. `safeFetch`
  // resolves the name BEFORE the request (a public name may point to 127.0.0.1 or 169.254.169.254) and follows no redirect
  // (it would replay the signed POST to an unverified target).
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
          'X-ReView-Delivery': String(deliveryId ?? ''),
          'X-ReView-Signature': signWebhookPayload(secret, timestamp, body),
        },
        body,
      },
      { timeoutMs: DELIVERY_TIMEOUT_MS, maxBytes: RESPONSE_READ_MAX_BYTES },
    );
    // The response is read even on success: a "200 OK" accompanied by an error body is the most common symptom of a
    // misconfigured relay.
    const responseBody = await readBodyExcerpt(res);
    if (res.ok) {
      await recordSuccess(webhookId, deliveryId, res.status, responseBody);
      return;
    }
    await recordFailure(webhookId, deliveryId, res.status, responseBody, `HTTP ${res.status}`);
    throw new Error(`Webhook ${webhookId} → HTTP ${res.status}`);
  } catch (err) {
    if (!(err instanceof Error && err.message.startsWith('Webhook '))) {
      await recordFailure(webhookId, deliveryId, null, null, errorText(err));
    }
    throw err;
  }
}

const errorText = (err: unknown) => (err as Error)?.message?.slice(0, 300) ?? 'erreur réseau';

/** Reads at most `RESPONSE_BODY_MAX` characters: an unreadable response does not make the delivery fail. */
async function readBodyExcerpt(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    return text ? text.slice(0, RESPONSE_BODY_MAX) : null;
  } catch {
    return null;
  }
}

async function recordSuccess(
  webhookId: number,
  deliveryId: number | null,
  status: number,
  responseBody: string | null,
): Promise<void> {
  if (deliveryId !== null)
    await prisma.webhookDelivery
      .update({
        where: { id: deliveryId },
        data: {
          attempts: { increment: 1 },
          status: 'DELIVERED',
          responseStatus: status,
          responseBody,
          error: null,
          deliveredAt: new Date(),
        },
      })
      .catch(ignoreFailure('[webhooks] delivery record update failed', { webhookId }));
  // The first success clears the streak: a recovering endpoint need not drag its past along.
  await prisma.webhook
    .update({
      where: { id: webhookId },
      data: { lastStatus: status, lastError: null, lastDeliveryAt: new Date(), failureStreak: 0 },
    })
    .catch(ignoreFailure('[webhooks] webhook status update failed', { webhookId }));
}

async function recordFailure(
  webhookId: number,
  deliveryId: number | null,
  status: number | null,
  responseBody: string | null,
  error: string,
): Promise<void> {
  let exhausted = false;
  if (deliveryId !== null) {
    const row = await prisma.webhookDelivery
      .update({
        where: { id: deliveryId },
        data: {
          attempts: { increment: 1 },
          status: 'FAILED',
          responseStatus: status,
          responseBody,
          error,
        },
        select: { attempts: true },
      })
      .catch(() => null);
    exhausted = (row?.attempts ?? 0) >= MAX_ATTEMPTS;
  }
  const hook = await prisma.webhook
    .update({
      where: { id: webhookId },
      data: {
        lastStatus: status,
        lastError: error,
        lastDeliveryAt: new Date(),
        ...(exhausted ? { failureStreak: { increment: 1 } } : {}),
      },
      select: { failureStreak: true },
    })
    .catch(() => null);
  // Repeatedly exhausted retries: the webhook is dead, so we stop writing to it. It stays in the database, reactivatable
  // with a checkbox once the endpoint is repaired.
  if (exhausted && (hook?.failureStreak ?? 0) >= FAILURE_STREAK_LIMIT) {
    await prisma.webhook
      .update({ where: { id: webhookId }, data: { active: false } })
      .catch(ignoreFailure('[webhooks] webhook deactivation failed', { webhookId }));
    logger.warn(`[webhooks] webhook ${webhookId} désactivé après ${FAILURE_STREAK_LIMIT} livraisons perdues`);
  }
}

export const deliverySelect = {
  id: true,
  event: true,
  status: true,
  attempts: true,
  responseStatus: true,
  responseBody: true,
  error: true,
  apiEventId: true,
  replayOfId: true,
  createdAt: true,
  deliveredAt: true,
} as const;

/** A webhook's journal, most recent first, by descending cursor on the id. */
export async function listDeliveries(webhookId: number, limit: number, before?: number) {
  const rows = await prisma.webhookDelivery.findMany({
    where: { webhookId, ...(before !== undefined ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' },
    take: limit,
    select: deliverySelect,
  });
  return {
    deliveries: rows,
    nextCursor: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
  };
}

/**
 * Replays a delivery: new row, new identifier, same event and same payload. The original row is not reused: what was lost must
 * stay readable next to what replaced it, otherwise the journal would rewrite history.
 */
export async function replayDelivery(webhookId: number, deliveryId: number): Promise<number | null> {
  const original = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, webhookId },
    select: { id: true, event: true, payload: true, apiEventId: true },
  });
  if (!original) return null;
  return queueDelivery(webhookId, original.event, (original.payload ?? {}) as Record<string, unknown>, {
    apiEventId: original.apiEventId,
    replayOfId: original.id,
  });
}
