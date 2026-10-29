// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registry of notifiable event types — **identical copy** of
 * `backend/src/lib/notificationKinds.ts`, which `notificationKinds.test.ts` (backend side)
 * refuses to let diverge. Same contract as `i18n/locales.json`: two packages, one list.
 *
 * The front end does not need it to display a notification (it reads its `type`), but to offer
 * the setting: the profile screen must not propose a kind that `notify()` does not consult, nor
 * silence a kind it does consult.
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

/** Top-level key of the preferences bag where these settings live. */
export const NOTIFICATION_SETTINGS_KEY = 'notifications';

export type NotificationSettings = Partial<Record<NotificationKind, { inApp?: boolean; push?: boolean }>>;

/**
 * Is this channel open for this kind? Same rule as on the server: only an explicit `false` closes,
 * everything else lets through. The ticked box is therefore the default state.
 */
export function channelEnabled(
  settings: NotificationSettings | undefined,
  kind: NotificationKind,
  channel: NotificationChannel,
): boolean {
  return settings?.[kind]?.[channel] !== false;
}

/**
 * Settings bag after toggling a channel — returned as-is to the preferences `PATCH`.
 *
 * The server merge is **shallow**: it replaces `notifications` as a whole. Hence copying the whole bag
 * here, otherwise ticking one box would erase all the others.
 */
export function withChannel(
  settings: NotificationSettings | undefined,
  kind: NotificationKind,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationSettings {
  return { ...settings, [kind]: { ...settings?.[kind], [channel]: enabled } };
}
