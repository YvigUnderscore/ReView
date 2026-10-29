// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Registry of the notifiable **event types** — the list the personal profile offers to configure, and the one `notify()`
 * consults before writing anything.
 *
 * It exists because `User.preferences` is a schema-less JSON bag: without a registry, a per-event setting would have been
 * written with a key invented at each call, nobody could list them, and the profile screen would have displayed what it
 * believed rather than what the server reads. The registry is **copied verbatim on the front end**
 * (`frontend/src/v2/lib/notificationKinds.ts`), and `notificationKinds.test.ts` refuses the two copies diverging — the same
 * contract as `i18n/locales.json`.
 *
 * The notification `type` (the one the browser reads to choose the icon and the destination of the click) is **derived**
 * from the kind: it used to be a free string passed at each call, and that is how a review decision had ended up written
 * `review_decision` where everything else is in capitals — a type the front end did not recognise, hence a click that
 * never opened the review.
 */
export const NOTIFICATION_KINDS = [
  'mention',
  'reply',
  'commentAssigned',
  'taskAssigned',
  'reviewAssigned',
  'reviewDecision',
  'watch',
  'live',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The two adjustable arrival channels: the in-app panel and the browser notification. */
export const NOTIFICATION_CHANNELS = ['inApp', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Kind → `Notification.type` served to the browser. One kind, one type, without exception. */
export const NOTIFICATION_TYPE: Record<NotificationKind, string> = {
  mention: 'MENTION',
  reply: 'REPLY',
  commentAssigned: 'COMMENT_ASSIGNED',
  taskAssigned: 'TASK_ASSIGNED',
  reviewAssigned: 'REVIEW_ASSIGNED',
  reviewDecision: 'REVIEW_DECISION',
  watch: 'WATCH',
  live: 'LIVE',
};

/** Top-level key of the preferences bag where these settings live. */
export const NOTIFICATION_SETTINGS_KEY = 'notifications';

/** An adjusted kind: each absent channel means "enabled". */
const kindSchema = z.object({ inApp: z.boolean().optional(), push: z.boolean().optional() }).strict();

/**
 * Admissible shape of `preferences.notifications`.
 *
 * The key is checked by a `refine` and not by `z.record(z.enum(...))`: a kind removed from the registry must not make the bag
 * of an account that had set it INVALID — the unknown is refused on write, not on read (`channelEnabled` ignores what it
 * does not know).
 */
export const notificationSettingsSchema = z
  .record(z.string().max(32), kindSchema)
  .refine((value) => Object.keys(value).every((k) => (NOTIFICATION_KINDS as readonly string[]).includes(k)), {
    message: 'Unknown notification kind',
  });

export type NotificationSettings = Partial<Record<NotificationKind, { inApp?: boolean; push?: boolean }>>;

/**
 * Is this channel open for this kind, for this recipient?
 *
 * **Only an explicit `false` closes.** Everything else — bag absent, kind never set, value of an unexpected shape — lets
 * through: an unreadable setting must not silently silence a notification nobody asked to silence, and a kind added later
 * therefore arrives enabled for everyone.
 */
export function channelEnabled(
  preferences: unknown,
  kind: NotificationKind,
  channel: NotificationChannel,
): boolean {
  if (!preferences || typeof preferences !== 'object') return true;
  const bag = (preferences as Record<string, unknown>)[NOTIFICATION_SETTINGS_KEY];
  if (!bag || typeof bag !== 'object') return true;
  const entry = (bag as Record<string, unknown>)[kind];
  if (!entry || typeof entry !== 'object') return true;
  return (entry as Record<string, unknown>)[channel] !== false;
}
