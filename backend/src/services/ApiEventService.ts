// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { WebhookEvent } from '../lib/webhooks';
import { emitWebhookEvent } from './WebhookService';

/**
 * v1 event journal.
 *
 * Two modes of consumption, for two workshop realities:
 *  - **webhooks** push the event to a public URL (a hosted Discord bot);
 *  - the **journal** is read by pulling (`GET /api/v1/events?since=...`), which remains the only option
 *    for a Prism daemon behind a studio's firewall, unreachable from outside.
 *
 * `publish` feeds both. Writing to the journal is deliberately non-blocking: a database incident must
 * not make a version publication fail.
 */

export interface EventInput {
  projectId?: number | null;
  entityType?: string;
  entityId?: number;
  actorId?: number | null;
  payload: Record<string, unknown>;
}

/**
 * Facts that both a layer and a route publish.
 *
 * `version.published` now comes from `VersionService`, which keeps the stream exact whatever the entry
 * point (UI, batch patch, media publication flow). The v1 route `PATCH /api/v1/versions/:id` still
 * publishes the same fact right after calling that service: without a guard, a v1 call would leave two
 * journal rows and two deliveries for a single publication.
 *
 * Coalescing is deliberately narrow: a single event name, a window of a few seconds, and a key that goes
 * down to the entity. Publishing the same version twice within five seconds is publishing it once. It is
 * not generalized to other events, where two close changes are two distinct facts.
 */
const COALESCED_EVENTS = new Set<WebhookEvent>(['version.published']);
const COALESCE_WINDOW_MS = 5_000;
const recentlyPublished = new Map<string, number>();

function isRepeatOfSameFact(event: WebhookEvent, input: EventInput): boolean {
  if (!COALESCED_EVENTS.has(event)) return false;
  const now = Date.now();
  // Purge first: the table must not grow with the number of entities touched.
  for (const [key, at] of recentlyPublished) if (now - at > COALESCE_WINDOW_MS) recentlyPublished.delete(key);
  const key = `${event}|${input.entityType ?? ''}|${input.entityId ?? ''}`;
  const seenAt = recentlyPublished.get(key);
  recentlyPublished.set(key, now);
  return seenAt !== undefined && now - seenAt <= COALESCE_WINDOW_MS;
}

/**
 * Journals the event and broadcasts it to subscribed webhooks.
 *
 * Never throws, not even synchronously: this function is called from the critical path (version
 * publication, comment posting), and a journal incident must never make the business action that
 * triggered it fail.
 *
 * The order has changed: the journal row is written BEFORE emission, so that its identifier travels with
 * the delivery. This is not blocking: everything stays within an unawaited promise, and a failed write
 * does not stop the delivery from going out, merely without a journal reference.
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
  /** Cursor: return only events with an id strictly greater than this. */
  since?: number;
  limit: number;
  projectIds?: number[];
  events?: string[];
}

/**
 * Page of events by increasing cursor. The cursor is an identifier, not a date: two events within the
 * same millisecond cannot hide one another.
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
    // Cursor to pass back unchanged on the next call; absent when the page is empty.
    cursor: rows.length > 0 ? rows[rows.length - 1]!.id : (params.since ?? null),
    hasMore: rows.length === params.limit,
  };
}

/**
 * Retention: the journal is purged by `lib/retention` (family `apiEvent`, 30 days by default, adjustable by
 * administrators). The guarantee that was missing here is added: deletion runs in capped batches instead of
 * a `DELETE` over the whole table. Client-side consequence unchanged: past that duration, a consumer that is
 * too far behind (`GET /api/v1/events?since=...`) restarts from the present instead of replaying history.
 */
