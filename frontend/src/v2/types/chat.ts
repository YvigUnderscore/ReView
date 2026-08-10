// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Messagerie interne (MP & groupes) — miroir des vues de `backend/services/ChatService`. */

/** Participant tel qu'affiché dans un fil (identité seule, sans coordonnées). */
export interface ChatUser {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

export interface ChatConversation {
  id: number;
  isGroup: boolean;
  /** Nom du groupe ; `null` pour un tête-à-tête (le nom est alors l'autre participant). */
  title: string | null;
  members: ChatUser[];
  lastMessage: { id: number; body: string; authorId: number | null; isSystem: boolean } | null;
  lastMessageAt: string;
  unread: number;
  muted: boolean;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  body: string;
  /** Message de service (arrivée, départ, renommage) : pas d'auteur, rendu en gris. */
  isSystem: boolean;
  createdAt: string;
  editedAt: string | null;
  author: ChatUser | null;
}
