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
 * Faits qu'une couche et une route publient tous les deux.
 *
 * `version.published` part désormais de `VersionService` — c'est ce qui rend le flux exact
 * quel que soit le point d'entrée (interface, patch en lot, flux de publication d'un
 * média). La route v1 `PATCH /api/v1/versions/:id` publie encore le même fait juste après
 * avoir appelé ce service : sans garde, un appel v1 laisserait deux lignes de journal et
 * deux livraisons pour une seule publication.
 *
 * La coalescence est volontairement étroite — un seul nom d'événement, une fenêtre de
 * quelques secondes, et une clé qui descend jusqu'à l'entité : publier deux fois la même
 * version en cinq secondes, c'est la publier une fois. Elle n'est pas généralisée aux
 * autres événements, où deux changements rapprochés sont deux faits distincts.
 */
const COALESCED_EVENTS = new Set<WebhookEvent>(['version.published']);
const COALESCE_WINDOW_MS = 5_000;
const recentlyPublished = new Map<string, number>();

function isRepeatOfSameFact(event: WebhookEvent, input: EventInput): boolean {
  if (!COALESCED_EVENTS.has(event)) return false;
  const now = Date.now();
  // Purge d'abord : la table ne doit pas grossir avec le nombre d'entités touchées.
  for (const [key, at] of recentlyPublished) if (now - at > COALESCE_WINDOW_MS) recentlyPublished.delete(key);
  const key = `${event}|${input.entityType ?? ''}|${input.entityId ?? ''}`;
  const seenAt = recentlyPublished.get(key);
  recentlyPublished.set(key, now);
  return seenAt !== undefined && now - seenAt <= COALESCE_WINDOW_MS;
}

/**
 * Journalise l'événement et le diffuse aux webhooks abonnés.
 *
 * Ne lève jamais, y compris de façon synchrone : cette fonction est appelée depuis le
 * chemin critique (publication d'une version, dépôt d'un commentaire), et un incident du
 * journal ne doit jamais faire échouer le geste métier qui l'a déclenché.
 *
 * L'ordre a changé : la ligne de journal est écrite AVANT l'émission, pour que son
 * identifiant accompagne la livraison. Ce n'est pas un blocage — l'ensemble reste dans une
 * promesse non attendue — et l'échec de l'écriture n'empêche pas la livraison de partir,
 * simplement sans référence au journal.
 */
export function publish(event: WebhookEvent, input: EventInput): void {
  try {
    if (isRepeatOfSameFact(event, input)) return;
    const projectId = input.projectId ?? null;
    const payload = { ...input.payload, projectId };
    void prisma.apiEvent
      .create({
        data: {
          event,
          projectId,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          actorId: input.actorId ?? null,
          payload: { ...input.payload, event },
        },
        select: { id: true },
      })
      .then(
        (row) => emitWebhookEvent(event, payload, { projectId, apiEventId: row.id }),
        (err) => {
          logger.warn({ err, event }, '[events] journalisation impossible');
          emitWebhookEvent(event, payload, { projectId, apiEventId: null });
        },
      );
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

/**
 * Rétention : le journal est purgé par `lib/retention` (famille `apiEvent`, 30 jours par
 * défaut, réglable par l'administration). Il s'y ajoute la garantie qui manquait ici — la
 * suppression part par tranches plafonnées au lieu d'un `DELETE` sur toute la table.
 * Conséquence inchangée côté client : passé la durée, un consommateur trop en retard
 * (`GET /api/v1/events?since=…`) repart du présent au lieu de rejouer l'historique.
 */
