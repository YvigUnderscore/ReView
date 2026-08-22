// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
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
 *
 * Deux propriétés se sont ajoutées et changent ce que le studio peut promettre :
 *  - **portée** : un webhook rattaché à un projet ne reçoit que ce projet, ce qui rend
 *    enfin donnable un webhook à un client sans lui ouvrir le catalogue du studio ;
 *  - **trace** : chaque livraison laisse une ligne (`WebhookDelivery`) avec son
 *    identifiant, ses tentatives, le statut HTTP et un extrait de la réponse. C'est cet
 *    identifiant que porte l'en-tête `X-ReView-Delivery` et le champ `id` du corps signé —
 *    de quoi dédupliquer une reprise côté consommateur, et rejouer côté administration.
 */

/** Extrait de réponse conservé : de quoi lire un message d'erreur, pas de quoi stocker une page. */
export const RESPONSE_BODY_MAX = 1000;

/**
 * Plafond de lecture de la réponse. On ne lisait pas le corps auparavant ; le journaliser
 * suppose de borner ce qu'un destinataire hostile peut nous faire télécharger. Au-delà,
 * `safeFetch` coupe et l'extrait est simplement absent — le statut, lui, reste enregistré.
 */
const RESPONSE_READ_MAX_BYTES = 64 * 1024;

/** Livraisons définitivement perdues, d'affilée, avant désactivation automatique. */
export const FAILURE_STREAK_LIMIT = 5;

/**
 * Miroir de `webhookQueue.defaultJobOptions.attempts` (JobService). La valeur est répétée
 * ici parce que le worker ne transmet pas le compteur BullMQ : c'est la tentative
 * numéro `MAX_ATTEMPTS` qui fait passer une livraison de « en cours de reprise » à
 * « perdue », et donc qui alimente la série d'échecs du webhook.
 */
const MAX_ATTEMPTS = 5;

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Clé d'enveloppe portant l'identifiant de livraison à travers la file.
 *
 * `WebhookJobData` (services/JobService) ne transporte que `{ webhookId, event, payload }`
 * et `workers/webhook.worker` ne passe que ces trois champs : l'identifiant voyage donc
 * dans la charge, sous une clé réservée que `deliver` retire avant de signer. Le corps
 * envoyé au destinataire n'en porte aucune trace — il reçoit l'identifiant à sa place
 * normale, `id` à la racine et en-tête `X-ReView-Delivery`.
 */
const DELIVERY_ENVELOPE_KEY = '_reviewDeliveryId';

export interface EmitOptions {
  /** Projet concerné — `null` pour un fait de studio (aucun webhook de projet ne le reçoit). */
  projectId?: number | null;
  /** Ligne du journal v1 à l'origine de l'émission, si elle a pu être écrite. */
  apiEventId?: number | null;
}

/**
 * Abonnés à servir pour un événement donné.
 *
 * Un webhook sans projet est un webhook de studio : il reçoit tout, comme avant. Un
 * webhook rattaché à un projet ne reçoit que les événements de CE projet — et un événement
 * qui n'appartient à aucun projet ne lui parvient pas, faute de pouvoir affirmer qu'il le
 * concerne.
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
 * Ouvre une ligne de journal puis enfile le job qui la portera.
 *
 * L'ordre compte : la ligne existe avant la première tentative, si bien qu'une livraison
 * qui échouera cinq fois est visible dès la première seconde au lieu d'apparaître — ou
 * pas — à la fin.
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

/** Sépare l'identifiant de livraison de la charge réellement envoyée au destinataire. */
export function unpackDelivery(payload: Record<string, unknown>): {
  deliveryId: number | null;
  data: Record<string, unknown>;
} {
  const { [DELIVERY_ENVELOPE_KEY]: raw, ...data } = payload;
  return { deliveryId: typeof raw === 'number' ? raw : null, data };
}

/** Livraison effective (worker) — lève en cas d'échec pour déclencher le retry BullMQ. */
export async function deliver(
  webhookId: number,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const hook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!hook || !hook.active) return; // désactivé/supprimé entre-temps : rien à faire
  const { deliveryId, data } = unpackDelivery(payload);
  const secret = decryptSecret(hook.secret) ?? '';
  const timestamp = String(Date.now());
  const body = JSON.stringify({ id: deliveryId, event, timestamp: Number(timestamp), data });

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
          'X-ReView-Delivery': String(deliveryId ?? ''),
          'X-ReView-Signature': signWebhookPayload(secret, timestamp, body),
        },
        body,
      },
      { timeoutMs: DELIVERY_TIMEOUT_MS, maxBytes: RESPONSE_READ_MAX_BYTES },
    );
    // La réponse est lue même en cas de succès : un « 200 OK » accompagné d'un corps
    // d'erreur est le symptôme le plus courant d'un relais mal configuré.
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

/** Lit au plus `RESPONSE_BODY_MAX` caractères — une réponse illisible ne fait pas échouer. */
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
      .catch(() => undefined);
  // Le premier succès efface la série : un endpoint qui repart n'a pas à traîner son passé.
  await prisma.webhook
    .update({
      where: { id: webhookId },
      data: { lastStatus: status, lastError: null, lastDeliveryAt: new Date(), failureStreak: 0 },
    })
    .catch(() => undefined);
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
  // Reprises épuisées à répétition : le webhook est mort, on cesse de lui écrire. Il reste
  // en base, réactivable d'une case à cocher une fois l'endpoint réparé.
  if (exhausted && (hook?.failureStreak ?? 0) >= FAILURE_STREAK_LIMIT) {
    await prisma.webhook.update({ where: { id: webhookId }, data: { active: false } }).catch(() => undefined);
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

/** Journal d'un webhook, les plus récentes d'abord, par curseur décroissant sur l'id. */
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
 * Rejoue une livraison : nouvelle ligne, nouvel identifiant, même événement et même
 * charge. On ne réutilise pas la ligne d'origine — ce qui a été perdu doit rester lisible
 * à côté de ce qui l'a remplacé, sinon le journal réécrit l'histoire.
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
