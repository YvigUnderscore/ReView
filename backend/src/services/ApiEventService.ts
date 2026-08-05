// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { WebhookEvent } from '../lib/webhooks';
import { emitWebhookEvent } from './WebhookService';

/**
 * Journal d'événements de l'API v1.
 *
 * Deux modes de consommation, pour deux réalités d'atelier :
 *  - les **webhooks** poussent l'événement vers une URL publique (bot Discord hébergé) ;
 *  - le **journal** se lit en tirant (`GET /api/v1/events?since=…`), ce qui reste la seule
 *    option pour un daemon Prism derrière le pare-feu d'un studio, injoignable de dehors.
 *
 * `publish` alimente les deux. L'écriture du journal est volontairement non bloquante :
 * un incident de base n'a pas à faire échouer la publication d'une version.
 */

export interface EventInput {
  projectId?: number | null;
  entityType?: string;
  entityId?: number;
  actorId?: number | null;
  payload: Record<string, unknown>;
}

/**
 * Journalise l'événement et le diffuse aux webhooks abonnés.
 *
 * Ne lève jamais, y compris de façon synchrone : cette fonction est appelée depuis le
 * chemin critique (publication d'une version, dépôt d'un commentaire), et un incident du
 * journal ne doit jamais faire échouer le geste métier qui l'a déclenché.
 */
export function publish(event: WebhookEvent, input: EventInput): void {
  try {
    void prisma.apiEvent
      .create({
        data: {
          event,
          projectId: input.projectId ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          actorId: input.actorId ?? null,
          payload: { ...input.payload, event } as object,
        },
      })
      .catch((err) => logger.warn({ err, event }, '[events] journalisation impossible'));

    emitWebhookEvent(event, { ...input.payload, projectId: input.projectId ?? null });
  } catch (err) {
    logger.warn({ err, event }, '[events] publication impossible');
  }
}

export interface ListEventsParams {
  /** Curseur : ne renvoyer que les événements d'id strictement supérieur. */
  since?: number;
  limit: number;
  projectIds?: number[];
  events?: string[];
}

/**
 * Page d'événements par curseur croissant. Le curseur est un identifiant, pas une date :
 * deux événements de la même milliseconde ne peuvent pas se masquer l'un l'autre.
 */
export async function list(params: ListEventsParams) {
  const rows = await prisma.apiEvent.findMany({
    where: {
      ...(params.since !== undefined ? { id: { gt: params.since } } : {}),
      ...(params.projectIds ? { projectId: { in: params.projectIds } } : {}),
      ...(params.events?.length ? { event: { in: params.events } } : {}),
    },
    orderBy: { id: 'asc' },
    take: params.limit,
    select: {
      id: true,
      event: true,
      projectId: true,
      entityType: true,
      entityId: true,
      payload: true,
      createdAt: true,
      actor: { select: { id: true, name: true, username: true } },
    },
  });
  return {
    events: rows,
    // Curseur à repasser tel quel au prochain appel — absent si la page est vide.
    cursor: rows.length > 0 ? rows[rows.length - 1]!.id : (params.since ?? null),
    hasMore: rows.length === params.limit,
  };
}

/** Rétention du journal, en jours. Au-delà, un client trop en retard repart du présent. */
export const EVENT_RETENTION_DAYS = 30;

/** Purge les événements expirés (worker de maintenance). */
export async function purge(now = new Date()): Promise<number> {
  const { count } = await prisma.apiEvent.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - EVENT_RETENTION_DAYS * 86_400_000) } },
  });
  return count;
}
