// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Notification } from '../types/api';
import { hasMessage, type MessageKey, type TParams } from '../i18n';

/**
 * Sentence of a notification, in the reader's language (D2).
 *
 * It was written in French **in the database** at the time of the event, then served as-is to
 * everyone — a Japanese studio read the French "Tâche assignée" ("task assigned"). The server now stores a key and its
 * parameters; `content` is still returned, in English, and serves as the fallback for notifications
 * predating this change.
 *
 * That fallback was **dead in production**: `isKnownKey` defaulted to `() => true` and no caller
 * passed anything else, so a key unknown to the catalogue — a server newer than the open tab, a
 * deployment in progress — was displayed as-is: the reader saw "notification.reviewNoteUpdated" where
 * `content` already held the English sentence. The default is now `hasMessage`, and the parameter
 * remains only for the test.
 */
export function notificationText(
  t: (key: MessageKey, params?: TParams) => string,
  notification: Pick<Notification, 'messageKey' | 'params' | 'content'>,
  isKnownKey: (key: string) => boolean = hasMessage,
): string {
  const key = notification.messageKey;
  if (!key || !isKnownKey(key)) return notification.content;
  return t(key as MessageKey, notification.params ?? undefined);
}
