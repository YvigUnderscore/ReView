// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { shotgridQueue } from '../JobService';
import { asEntityRef, asString } from './shotgridMapper';
import { eventBelongsToProject } from './shotgridProjectGuard';
import { parseSettings } from './shotgridSettings';
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

/** Entités que ReView sait traiter — le reste est ignoré sans bruit. */
const HANDLED = new Set([
  'Shot',
  'Sequence',
  'Asset',
  'Task',
  'Version',
  'Note',
  'Playlist',
  'Status',
  'HumanUser',
]);

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
    if (!HANDLED.has(parsed.entity)) continue;

    await shotgridQueue.add(
      'event',
      { kind: 'event', connectionId, event: data, deliveryId: meta.deliveryId ?? null },
      {
        jobId: `sgevt:${connectionId}:${parsed.entity}:${entityRef.id}`,
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
 * Trace des valeurs que ReView vient d'écrire dans ShotGrid.
 *
 * Sans elle, l'événement que ShotGrid renvoie pour notre propre écriture serait relu
 * comme un changement distant : pas de corruption — la valeur est déjà la bonne — mais
 * un aller-retour inutile à chaque modification. La trace vit en mémoire du worker,
 * qui est à la fois l'auteur des écritures et le lecteur des événements. Si plusieurs
 * workers tournaient, le pire serait une relecture superflue.
 */
const echoes = new Map<string, { value: string; expiresAt: number }>();
const ECHO_TTL_MS = 120_000;

function echoKey(connectionId: number, sgType: string, sgId: number, field: string): string {
  return `${connectionId}:${sgType}:${sgId}:${field}`;
}

export async function markEcho(
  connectionId: number,
  sgType: string,
  sgId: number,
  field: string,
  value: unknown,
): Promise<void> {
  const now = Date.now();
  for (const [key, entry] of echoes) if (entry.expiresAt <= now) echoes.delete(key);
  echoes.set(echoKey(connectionId, sgType, sgId, field), {
    value: JSON.stringify(value ?? null),
    expiresAt: now + ECHO_TTL_MS,
  });
}

export async function isEcho(
  connectionId: number,
  sgType: string,
  sgId: number,
  field: string | undefined,
  value: unknown,
): Promise<boolean> {
  if (!field) return false;
  const entry = echoes.get(echoKey(connectionId, sgType, sgId, field));
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    echoes.delete(echoKey(connectionId, sgType, sgId, field));
    return false;
  }
  return entry.value === JSON.stringify(value ?? null);
}

/** Vide la trace — utilisé par les tests. */
export function clearEchoes(): void {
  echoes.clear();
}

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

  const field = event.meta?.attribute_name;
  if (await isEcho(connectionId, parsed.entity, entityRef.id, field, event.meta?.new_value)) {
    logger.debug(
      { connectionId, entity: parsed.entity, id: entityRef.id, field },
      'Écho de notre propre écriture ignoré',
    );
    return;
  }

  const settings = parseSettings(connection.settings);
  if (settings.eventMode === 'manual') return;

  // Une entité globale (statut, compte) touche tout le projet : passe complète, mais
  // sans les médias, qui n'ont pas pu changer.
  const isGlobal = parsed.entity === 'Status' || parsed.entity === 'HumanUser';
  await runSync(connection.projectId, {
    kind: 'webhook',
    ...(isGlobal
      ? { withMedia: false }
      : {
          onlySgIds: [{ sgType: parsed.entity, sgId: entityRef.id }],
          withMedia: parsed.entity === 'Version',
        }),
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
