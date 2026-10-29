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
 * ShotGrid event processing (webhooks or polling of the event log).
 *
 * An event does not say everything: its payload is capped at one megabyte and is truncated beyond that. Rather than trusting it, we use it
 * as a doorbell: it indicates WHAT to re-read, and the re-read is authoritative. This is also what makes processing identical in webhook mode
 * and in periodic polling mode.
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

/** Coalescing window for events concerning the same entity. */
const COALESCE_MS = 5_000;

/**
 * What to group events of the same time slice on.
 *
 * A production entity is grouped by identifier: two shots modified together are two re-reads, each targeted. A **global** entity (status, account),
 * on the other hand, triggers exactly the same work whatever its identifier: a re-read of the whole project hierarchy. Putting it in there cost a lot
 * for nothing: renaming fifty accounts at once produced fifty full passes where a single one says the same thing.
 *
 * It becomes a real risk as soon as a second webhook, without a project filter, brings the site's `Person` and `Status` records: the only way to receive them,
 * since ShotGrid does not offer them in a webhook filtered on a project.
 */
export function coalesceKey(entity: string, sgId: number): string {
  return eventIsGlobal(entity) ? entity : `${entity}-${sgId}`;
}

export function parseEventType(eventType: string | undefined): { entity: string; action: string } | null {
  if (!eventType) return null;
  const m = ENTITY_FROM_EVENT.exec(eventType);
  if (!m) return null;
  return { entity: m[1]!, action: m[2]! };
}

/**
 * Pushes an event onto the queue.
 *
 * The task identifier is deterministic (connection + entity) and the triggering is deferred by a few seconds: changing the status of a hundred tasks at once
 * in ShotGrid produces a hundred events, but a single re-read per entity concerned.
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
                // The identifier groups the events of the same entity per COALESCE_MS slice: a batch modification triggers only one re-read, but a
                // change occurring later is not confused with the previous one. Without the slice, the identifier would stay taken by the work already done
                // and every later event would be silently ignored. No colons: BullMQ reserves them for its own keys and rejects the identifier.
        jobId: `sgevt-${connectionId}-${coalesceKey(parsed.entity, entityRef.id)}-${Math.floor(Date.now() / COALESCE_MS)}`,
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
 * No echo guard, deliberately.
 *
 * An in-memory map used to retain the values ReView had just written, to ignore the event the site sent back afterwards. It cost more than it returned:
 * the entry was never consumed and lived two minutes, so a real change bringing back the same value within that interval was swallowed, and the coalescing of
 * jobs (same `jobId` over five seconds) could make the only job that would have re-read the entity give up. A status lost in silence: exactly what we are trying to avoid.
 *
 * What it saved is a targeted re-read of one entity: one request, idempotent. We gladly pay for it.
 */

/**
 * Applies an event: targeted re-read of the entity concerned.
 * The project isolation is checked BEFORE any work: a webhook misconfigured on the ShotGrid side can perfectly well deliver the events of the whole studio.
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
     * Each event type has its passes.
     *
     * The old code had only one switch, `withMedia`, tied to `entity === 'Version'`. Consequence: a Note or Playlist event was accepted, queued, processed,
     * and triggered no import, since the only two passes able to read them were behind that `false`. The outbound direction worked, the inbound one was dead.
     * A global entity (status, account) remains a re-read of the whole hierarchy; the others only re-read themselves.
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
 * Polling of the event log: fallback when the instance is not reachable from the Internet (studio behind a private network). The cursor only advances over
 * processed events: an outage resumes where it stopped.
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
