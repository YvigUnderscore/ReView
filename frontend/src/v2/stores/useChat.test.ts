// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { conversationLabel, selectUnreadTotal } from './useChat';
import type { ChatConversation } from '../types/chat';

const user = (id: number, displayName: string) => ({ id, displayName, initials: 'XX', avatarUrl: null });

const conversation = (over: Partial<ChatConversation> = {}): ChatConversation => ({
  id: 1,
  isGroup: false,
  title: null,
  members: [user(1, 'Moi'), user(2, 'Ana')],
  lastMessage: null,
  lastMessageAt: '2026-08-10T10:00:00Z',
  unread: 0,
  muted: false,
  ...over,
});

describe('conversationLabel', () => {
  it('nomme un tête-à-tête par la personne en face', () => {
    expect(conversationLabel(conversation(), 1, 'Vous')).toBe('Ana');
  });

  it('préfère le titre du groupe quand il y en a un', () => {
    expect(conversationLabel(conversation({ isGroup: true, title: 'Lighting' }), 1, 'Vous')).toBe('Lighting');
  });

  it('énumère les participants d’un groupe sans titre', () => {
    const c = conversation({
      isGroup: true,
      members: [user(1, 'Moi'), user(2, 'Ana'), user(3, 'Bo')],
    });
    expect(conversationLabel(c, 1, 'Vous')).toBe('Ana, Bo');
  });

  it('retombe sur le libellé fourni si l’on est seul dans le fil', () => {
    expect(conversationLabel(conversation({ members: [user(1, 'Moi')] }), 1, 'Vous')).toBe('Vous');
  });
});

describe('selectUnreadTotal', () => {
  it('additionne les non-lus de tous les fils', () => {
    const state = {
      conversations: [conversation({ id: 1, unread: 2 }), conversation({ id: 2, unread: 3 })],
    } as Parameters<typeof selectUnreadTotal>[0];
    expect(selectUnreadTotal(state)).toBe(5);
  });
});
