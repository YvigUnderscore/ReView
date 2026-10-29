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
  it('names a one-to-one thread after the other person', () => {
    expect(conversationLabel(conversation(), 1, 'Vous')).toBe('Ana');
  });

  it('prefers the group title when there is one', () => {
    expect(conversationLabel(conversation({ isGroup: true, title: 'Lighting' }), 1, 'Vous')).toBe('Lighting');
  });

  it('lists the participants of an untitled group', () => {
    const c = conversation({
      isGroup: true,
      members: [user(1, 'Moi'), user(2, 'Ana'), user(3, 'Bo')],
    });
    expect(conversationLabel(c, 1, 'Vous')).toBe('Ana, Bo');
  });

  it('falls back to the provided label when we are alone in the thread', () => {
    expect(conversationLabel(conversation({ members: [user(1, 'Moi')] }), 1, 'Vous')).toBe('Vous');
  });
});

describe('selectUnreadTotal', () => {
  it('adds up the unread counts of all threads', () => {
    const state = {
      conversations: [conversation({ id: 1, unread: 2 }), conversation({ id: 2, unread: 3 })],
    } as Parameters<typeof selectUnreadTotal>[0];
    expect(selectUnreadTotal(state)).toBe(5);
  });
});
