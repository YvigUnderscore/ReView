// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { WEBHOOK_EVENTS, type WebhookEvent } from './webhooks';

/**
 * What a webhook can actually receive.
 *
 * The `WEBHOOK_EVENTS` catalog serves as vocabulary (types, `/api/v1/schema`), but eight of its
 * eighteen names never had an emission point: an administrator could subscribe to `shot.created`
 * or `media.failed` and wait indefinitely for a call that would never come. A subscription that
 * cannot be honored is worse than a missing event: it makes them believe an alert is wired up.
 *
 * `EMITTED_WEBHOOK_EVENTS` is therefore the list that administration offers and that validation
 * accepts when a webhook is created; `PHANTOM_WEBHOOK_EVENTS` lists what remains to be wired up.
 * The neighboring test re-reads the sources: if one of the phantoms starts being published, or if
 * an emitted event is missing from the list, the suite reports it.
 */

/** Events actually published by at least one point in the code (auditable, tested). */
export const EMITTED_WEBHOOK_EVENTS = [
  'media.published',
  'review.decision',
  'comment.created',
  'comment.resolved',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'version.created',
  'version.published',
  'version.reviewers_changed',
] as const satisfies readonly WebhookEvent[];

export type EmittedWebhookEvent = (typeof EMITTED_WEBHOOK_EVENTS)[number];

/**
 * Names of the catalog with no emission point. They remain typed (a legacy consumer may have them
 * in the database) but are no longer offered or accepted for subscription.
 *
 * Wiring them requires touching the corresponding write services (`ProjectService`,
 * `SequenceService`, `ShotService`, `AssetService`, `MediaUploadService`, `workers/ffmpeg.worker`):
 * the day it is done, the entry simply moves into `EMITTED_WEBHOOK_EVENTS`.
 */
export const PHANTOM_WEBHOOK_EVENTS = WEBHOOK_EVENTS.filter(
  (e): e is Exclude<WebhookEvent, EmittedWebhookEvent> =>
    !(EMITTED_WEBHOOK_EVENTS as readonly string[]).includes(e),
);

export const isEmittedWebhookEvent = (value: string): value is EmittedWebhookEvent =>
  (EMITTED_WEBHOOK_EVENTS as readonly string[]).includes(value);
