// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { shotgridQueue } from '../JobService';
import { asEntityRef, asString } from './shotgridMapper';
import { eventBelongsToProject } from './shotgridProjectGuard';
import { parseSettings } from './shotgridSettings';
import { eventIsGlobal, HANDLED_ENTITIES, passesForEvent } from './ShotgridSyncPasses';
import { runSync } from './ShotgridSyncService';

/**
 * Traitement des événements ShotGrid (webhooks ou relevé du journal d'événements).
 *
 * Un événement ne dit pas tout : sa charge utile est plafonnée à un mégaoctet et se
 * fait amputer au-delà. Plutôt que de lui faire confiance, on s'en sert comme d'une
 * sonnette — il indique QUOI relire, et la lecture fait autorité. C'est aussi ce qui
 * rend le traitement identique en mode webhook et en mode relevé périodique.
 */

export interface ShotgridEventPayload {
  event_type?: string;
  entity?: unknown;
  project?: unknown;
  meta?: { attribute_name?: string; new_value?: unknown; old_value?: unknown };
  operation?: string;
  id?: number;
}

const ENTITY_FROM_EVENT = /^Shotgun_([A-Za-z]+)_(New|Change|Retirement|Revival)$/;

/** Fenêtre de regroupement des événements portant sur une même entité. */
const COALESCE_MS = 5_000;

export function parseEventType(eventType: string | undefined): { entity: string; action: string } | null {
  if (!eventType) return null;
  const m = ENTITY_FROM_EVENT.exec(eventType);
  if (!m) return null;
  return { entity: m[1]!, action: m[2]! };
}

/**
 * Empile un événement.
 *
 * L'identifiant de tâche est déterministe (connexion + entité) et le déclenchement
 * différé de quelques secondes : changer le statut de cent tâches d'un coup dans
 * ShotGrid produit cent événements, mais une seule relecture par entité concernée.
 */
export async function enqueueShotgridEvent(
  connectionId: number,
  payload: unknown,
  meta: { deliveryId?: string | null; batchId?: string | null } = {},
): Promise<void> {
  const events = Array.isArray(payload) ? payload : [payload];
  for (const raw of events) {
    const data = (raw as { data?: ShotgridEventPayload })?.data ?? (raw as ShotgridEventPayload);
    const parsed = parseEventType(data?.event_type);
    const entityRef = asEntityRef(data?.entity);
    if (!parsed || !entityRef) continue;
    if (!HANDLED_ENTITIES.has(parsed.entity)) continue;

    await shotgridQueue.add(
      'event',
      { kind: 'event', connectionId, event: data, deliveryId: meta.deliveryId ?? null },
      {
        // L'identifiant regroupe les événements d'une même entité par tranche de
        // COALESCE_MS : une modification en lot n'entraîne qu'une relecture, mais un
        // changement survenu plus tard n'est pas confondu avec le précédent. Sans la
        // tranche, l'identifiant resterait pris par le travail déjà terminé et tout
        // événement ultérieur serait silencieusement ignoré. Pas de deux-points :
        // BullMQ les réserve à ses propres clés et rejette l'identifiant.
        jobId: `sgevt-${connectionId}-${parsed.entity}-${entityRef.id}-${Math.floor(Date.now() / COALESCE_MS)}`,
        delay: 2000,
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );
  }
  await prisma.shotgridConnection.update({
    where: { id: connectionId },
    data: { lastEventAt: new Date() },
  });
}

/**
 * Pas de garde-fou d'écho — c'est délibéré.
 *
 * Une carte en mémoire retenait les valeurs que ReView venait d'écrire, pour ignorer
 * l'événement que le site nous renvoyait ensuite. Elle coûtait plus qu'elle ne rapportait :
 * l'entrée n'était jamais consommée et vivait deux minutes, si bien qu'un vrai changement
 * ramenant la même valeur dans cet intervalle était avalé, et que la coalescence des jobs
 * (même `jobId` sur cinq secondes) pouvait faire abandonner le seul job qui aurait relu
 * l'entité. Un statut perdu en silence — exactement ce qu'on cherche à éviter.
 *
 * Ce qu'elle économisait est une relecture ciblée d'une entité : une requête, idempotente.
 * On la paie volontiers.
 */

/**
 * Applique un événement : relecture ciblée de l'entité concernée.
 * Le cloisonnement projet est vérifié AVANT tout travail — un webhook mal configuré
 * côté ShotGrid peut parfaitement livrer les événements de tout le studio.
 */
export async function handleEvent(connectionId: number, event: ShotgridEventPayload): Promise<void> {
  const connection = await prisma.shotgridConnection.findUnique({ where: { id: connectionId } });
  if (!connection || !connection.active) return;

  const parsed = parseEventType(event.event_type);
  const entityRef = asEntityRef(event.entity);
  if (!parsed || !entityRef) return;

  const scope = { sgProjectId: connection.sgProjectId, sgProjectName: connection.sgProjectName };
  if (!eventBelongsToProject(event, scope)) {
    logger.warn(
      {
        connectionId,
        eventType: event.event_type,
        project: asString((event.project as { name?: string })?.name),
      },
      'Événement ShotGrid hors du projet lié — ignoré',
    );
    return;
  }

  const settings = parseSettings(connection.settings);
  if (settings.eventMode === 'manual') return;

  /**
   * À chaque type d'événement ses passes.
   *
   * L'ancien code n'avait qu'un interrupteur, `withMedia`, calé sur
   * `entity === 'Version'`. Conséquence : un événement Note ou Playlist était accepté,
   * mis en file, traité — et ne déclenchait aucun import, puisque les deux seules passes
   * capables de les lire étaient derrière ce `false`. Le sens sortant marchait, le sens
   * entrant était mort. Une entité globale (statut, compte) reste une relecture de toute
   * la hiérarchie ; les autres ne relisent qu'elles-mêmes.
   */
  const passes = passesForEvent(parsed.entity);
  if (!passes) return;
  await runSync(connection.projectId, {
    kind: 'webhook',
    passes: [...passes],
    ...(eventIsGlobal(parsed.entity) ? {} : { onlySgIds: [{ sgType: parsed.entity, sgId: entityRef.id }] }),
  });
}

/**
 * Relevé du journal d'événements — repli quand l'instance n'est pas joignable depuis
 * Internet (studio derrière un réseau privé). Le curseur avance uniquement sur les
 * événements traités : une coupure reprend là où elle s'est arrêtée.
 */
export async function pollEvents(connectionId: number): Promise<number> {
  const connection = await prisma.shotgridConnection.findUnique({
    where: { id: connectionId },
    include: { site: true },
  });
  if (!connection || !connection.active) return 0;

  const { clientForSiteRecord } = await import('./ShotgridConfigService');
  const client = clientForSiteRecord(connection.site);
  const filters: Array<[string, string, unknown]> = [
    ['project', 'is', { type: 'Project', id: connection.sgProjectId }],
  ];
  if (connection.lastEventId) filters.push(['id', 'greater_than', Number(connection.lastEventId)]);

  const records = await client.search('EventLogEntry', {
    fields: ['event_type', 'entity', 'project', 'meta', 'created_at'],
    filters,
    sort: 'id',
    maxRecords: 500,
  });
  if (records.length === 0) return 0;

  for (const record of records) {
    await handleEvent(connectionId, {
      event_type: asString(record.event_type) ?? undefined,
      entity: record.entity,
      project: record.project,
      meta: record.meta as ShotgridEventPayload['meta'],
    });
  }

  const lastId = records[records.length - 1]!.id;
  await prisma.shotgridConnection.update({
    where: { id: connectionId },
    data: { lastEventId: BigInt(lastId), lastEventAt: new Date() },
  });
  return records.length;
}
