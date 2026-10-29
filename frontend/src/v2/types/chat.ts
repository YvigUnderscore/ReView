// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Internal messaging (DMs & groups) — mirror of the views of `backend/services/ChatService`. */

/** Participant as shown in a thread (identity only, no contact details). */
export interface ChatUser {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

/**
 * Sentence of a system message: the i18n key and its variables, not text. It used to be written in
 * French IN THE DATABASE, hence frozen for every reader; `body` is still returned, in English, and
 * serves as a fallback for messages posted before this change.
 */
export interface ChatSystemPhrase {
  body: string;
  systemKey: string | null;
  systemVars: Record<string, string | number> | null;
}

export interface ChatConversation {
  id: number;
  isGroup: boolean;
  /** Group name; `null` for a one-to-one (the name is then the other participant). */
  title: string | null;
  members: ChatUser[];
  lastMessage: (ChatSystemPhrase & { id: number; authorId: number | null; isSystem: boolean }) | null;
  lastMessageAt: string;
  unread: number;
  muted: boolean;
}

export interface ChatMessage extends ChatSystemPhrase {
  id: number;
  conversationId: number;
  /** System message (arrival, departure, rename): no author, rendered in grey. */
  isSystem: boolean;
  createdAt: string;
  editedAt: string | null;
  author: ChatUser | null;
}
