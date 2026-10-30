// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChatSystemPhrase } from '../types/chat';
import type { MessageKey, TParams } from '../i18n';

/**
 * Sentence of a chat message, in the reader's language.
 *
 * A written message has nothing to translate: it returns its body as typed. A system message
 * (arrival, departure, rename), on the other hand, was written **in French in the database** at the
 * time of the event, then served as-is to everyone — a Japanese studio read the French
 * "a rejoint la conversation" ("joined the conversation"), and nothing could translate it any
 * more. The server now stores a key and its variables; `body` is still returned, in English, and
 * serves as the fallback for messages predating this change.
 *
 * Same contract as `notificationText` — both surfaces have the same debt and the same fallback.
 */
export function chatSystemText(
  t: (key: MessageKey, params?: TParams) => string,
  message: ChatSystemPhrase,
  isKnownKey: (key: string) => boolean = () => true,
): string {
  const key = message.systemKey;
  if (!key || !isKnownKey(key)) return message.body;
  return t(key as MessageKey, message.systemVars ?? undefined);
}
