// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { api } from '../../lib/apiClient';
import { getSocket } from '../../lib/socket';
import type { ChatConversation, ChatMessage } from '../types/chat';

/**
 * Internal messaging (DMs & groups) — state shared by the sidebar footer and the conversation
 * window. A store rather than a TanStack query: the thread lives in real time (socket), stays open
 * while navigating, and its unread counter is read from several places in the interface.
 */

interface ChatState {
  conversations: ChatConversation[];
  /** Messages loaded per thread, from oldest to newest. */
  messages: Record<number, ChatMessage[]>;
  /** Thread shown in the floating window (`null` = closed). */
  openId: number | null;
  loading: boolean;
  /** `true` when the oldest page of the thread has been reached. */
  atStart: Record<number, boolean>;

  start: () => void;
  reload: () => Promise<void>;
  open: (id: number) => void;
  close: () => void;
  /** Opens (or creates) the one-to-one thread with a user. */
  openWith: (userId: number) => Promise<void>;
  createGroup: (userIds: number[], title: string) => Promise<void>;
  send: (id: number, body: string) => Promise<void>;
  loadOlder: (id: number) => Promise<void>;
  markRead: (id: number) => Promise<void>;
  rename: (id: number, title: string) => Promise<void>;
  addMembers: (id: number, userIds: number[]) => Promise<void>;
  /** Leaves a group (`selfId` = one's own identifier: the route removes a member). */
  leave: (id: number, selfId: number) => Promise<void>;
}

/** Threads sorted from most recently active to oldest (list order). */
const byRecency = (list: ChatConversation[]) =>
  [...list].sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

/** A given thread must appear only once; the received version is authoritative. */
const upsert = (list: ChatConversation[], next: ChatConversation) =>
  byRecency([next, ...list.filter((c) => c.id !== next.id)]);

let socketBound = false;

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  messages: {},
  openId: null,
  loading: false,
  atStart: {},

  /** Loads the threads and wires up real time — idempotent (mounted by the sidebar footer). */
  start: () => {
    if (socketBound) return;
    socketBound = true;
    void get().reload();
    const socket = getSocket();

    socket.on('chat:message', ({ message }: { message: ChatMessage }) => {
      const { openId, messages, conversations } = get();
      const known = messages[message.conversationId];
      // Only insert into an already loaded thread: otherwise the first opening would replay the
      // history with a gap between this message and the page actually loaded.
      if (known && !known.some((m) => m.id === message.id)) {
        set({ messages: { ...messages, [message.conversationId]: [...known, message] } });
      }
      const conv = conversations.find((c) => c.id === message.conversationId);
      if (conv) {
        const isOpen = openId === message.conversationId;
        set({
          conversations: upsert(conversations, {
            ...conv,
            lastMessage: {
              id: message.id,
              body: message.body,
              authorId: message.author?.id ?? null,
              isSystem: message.isSystem,
              // The key follows the message: without it, the thread preview would fall back to
              // the English `body` while the thread row is properly translated.
              systemKey: message.systemKey,
              systemVars: message.systemVars,
            },
            lastMessageAt: message.createdAt,
            unread: isOpen ? 0 : conv.unread + 1,
          }),
        });
        if (isOpen) void get().markRead(conv.id);
      } else {
        // Unknown thread (we have just been added to it): the full list is authoritative.
        void get().reload();
      }
    });

    socket.on('chat:conversation', ({ conversation }: { conversation: ChatConversation }) => {
      set({ conversations: upsert(get().conversations, conversation) });
    });

    socket.on('chat:read', ({ conversationId }: { conversationId: number }) => {
      set({
        conversations: get().conversations.map((c) => (c.id === conversationId ? { ...c, unread: 0 } : c)),
      });
    });

    socket.on('chat:left', ({ conversationId }: { conversationId: number }) => {
      const { openId, conversations, messages } = get();
      const rest = { ...messages };
      delete rest[conversationId];
      set({
        conversations: conversations.filter((c) => c.id !== conversationId),
        messages: rest,
        openId: openId === conversationId ? null : openId,
      });
    });

    socket.on('chat:deleted', ({ conversationId, messageId }: Record<string, number>) => {
      const list = get().messages[conversationId];
      if (!list) return;
      set({
        messages: { ...get().messages, [conversationId]: list.filter((m) => m.id !== messageId) },
      });
    });
  },

  reload: async () => {
    try {
      const { conversations } = await api.get<{ conversations: ChatConversation[] }>(
        '/api/chat/conversations',
      );
      set({ conversations: byRecency(conversations) });
    } catch {
      /* offline: the current list stays displayed */
    }
  },

  open: (id) => {
    set({ openId: id });
    const { messages } = get();
    if (!messages[id]) {
      set({ loading: true });
      void api
        .get<{ messages: ChatMessage[] }>(`/api/chat/conversations/${id}/messages`)
        .then(({ messages: page }) => {
          set({
            messages: { ...get().messages, [id]: page },
            atStart: { ...get().atStart, [id]: page.length < 50 },
          });
        })
        .catch(() => undefined)
        .finally(() => set({ loading: false }));
    }
    void get().markRead(id);
  },

  close: () => set({ openId: null }),

  openWith: async (userId) => {
    const { conversation } = await api.post<{ conversation: ChatConversation }>('/api/chat/conversations', {
      userIds: [userId],
    });
    set({ conversations: upsert(get().conversations, conversation) });
    get().open(conversation.id);
  },

  createGroup: async (userIds, title) => {
    const { conversation } = await api.post<{ conversation: ChatConversation }>('/api/chat/conversations', {
      userIds,
      title: title.trim() || null,
    });
    set({ conversations: upsert(get().conversations, conversation) });
    get().open(conversation.id);
  },

  send: async (id, body) => {
    const { message } = await api.post<{ message: ChatMessage }>(`/api/chat/conversations/${id}/messages`, {
      body,
    });
    // The socket echo also reaches the author: we only add if the event was lost.
    const list = get().messages[id] ?? [];
    if (!list.some((m) => m.id === message.id)) {
      set({ messages: { ...get().messages, [id]: [...list, message] } });
    }
  },

  loadOlder: async (id) => {
    const list = get().messages[id];
    if (!list?.length || get().atStart[id]) return;
    const { messages: page } = await api.get<{ messages: ChatMessage[] }>(
      `/api/chat/conversations/${id}/messages?before=${list[0].id}`,
    );
    set({
      messages: { ...get().messages, [id]: [...page, ...list] },
      atStart: { ...get().atStart, [id]: page.length < 50 },
    });
  },

  markRead: async (id) => {
    // No "already at zero" guard: a message received while the thread is open is zeroed locally
    // on arrival, and the guard would then stop the server from being told — the thread would come
    // back unread on the next reload.
    if (!get().conversations.some((c) => c.id === id)) return;
    set({ conversations: get().conversations.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) });
    await api.post(`/api/chat/conversations/${id}/read`).catch(() => undefined);
  },

  rename: async (id, title) => {
    const { conversation } = await api.patch<{ conversation: ChatConversation }>(
      `/api/chat/conversations/${id}`,
      { title },
    );
    set({ conversations: upsert(get().conversations, conversation) });
  },

  addMembers: async (id, userIds) => {
    const { conversation } = await api.post<{ conversation: ChatConversation }>(
      `/api/chat/conversations/${id}/members`,
      { userIds },
    );
    set({ conversations: upsert(get().conversations, conversation) });
  },

  leave: async (id, selfId) => {
    await api.del(`/api/chat/conversations/${id}/members/${selfId}`);
    // `chat:left` cleans up locally, but the one leaving must not wait for the socket round trip
    // to see the thread disappear.
    const rest = { ...get().messages };
    delete rest[id];
    set({
      conversations: get().conversations.filter((c) => c.id !== id),
      messages: rest,
      openId: get().openId === id ? null : get().openId,
    });
  },
}));

/** Total unread count, all threads combined (badge of the sidebar footer). */
export const selectUnreadTotal = (s: ChatState): number => s.conversations.reduce((n, c) => n + c.unread, 0);

/**
 * Display name of a thread: its title if it has one, otherwise the participants other than oneself —
 * a one-to-one is called after the other person, not "Conversation 12".
 */
export function conversationLabel(c: ChatConversation, selfId: number, fallback: string): string {
  if (c.title) return c.title;
  const others = c.members.filter((m) => m.id !== selfId);
  if (others.length === 0) return fallback;
  return others.map((m) => m.displayName).join(', ');
}
