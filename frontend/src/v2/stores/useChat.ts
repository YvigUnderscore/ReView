// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { create } from 'zustand';
import { api } from '../../lib/apiClient';
import { getSocket } from '../../lib/socket';
import type { ChatConversation, ChatMessage } from '../types/chat';

/**
 * Messagerie interne (MP & groupes) — état partagé par le pied de sidebar et la fenêtre
 * de conversation. Un store plutôt qu'une requête TanStack : le fil vit en temps réel
 * (socket), reste ouvert pendant la navigation, et son compteur de non-lus est lu depuis
 * plusieurs endroits de l'interface.
 */

interface ChatState {
  conversations: ChatConversation[];
  /** Messages chargés par fil, du plus ancien au plus récent. */
  messages: Record<number, ChatMessage[]>;
  /** Fil affiché dans la fenêtre flottante (`null` = fermée). */
  openId: number | null;
  loading: boolean;
  /** `true` quand la page la plus ancienne du fil est atteinte. */
  atStart: Record<number, boolean>;

  start: () => void;
  reload: () => Promise<void>;
  open: (id: number) => void;
  close: () => void;
  /** Ouvre (ou crée) le tête-à-tête avec un utilisateur. */
  openWith: (userId: number) => Promise<void>;
  createGroup: (userIds: number[], title: string) => Promise<void>;
  send: (id: number, body: string) => Promise<void>;
  loadOlder: (id: number) => Promise<void>;
  markRead: (id: number) => Promise<void>;
  rename: (id: number, title: string) => Promise<void>;
  addMembers: (id: number, userIds: number[]) => Promise<void>;
  /** Quitte un groupe (`selfId` = son propre identifiant : la route retire un membre). */
  leave: (id: number, selfId: number) => Promise<void>;
}

/** Fils triés du plus récemment actif au plus ancien (ordre de la liste). */
const byRecency = (list: ChatConversation[]) =>
  [...list].sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

/** Un même fil ne doit apparaître qu'une fois, la version reçue faisant foi. */
const upsert = (list: ChatConversation[], next: ChatConversation) =>
  byRecency([next, ...list.filter((c) => c.id !== next.id)]);

let socketBound = false;

export const useChat = create<ChatState>((set, get) => ({
  conversations: [],
  messages: {},
  openId: null,
  loading: false,
  atStart: {},

  /** Charge les fils et branche le temps réel — idempotent (monté par le pied de sidebar). */
  start: () => {
    if (socketBound) return;
    socketBound = true;
    void get().reload();
    const socket = getSocket();

    socket.on('chat:message', ({ message }: { message: ChatMessage }) => {
      const { openId, messages, conversations } = get();
      const known = messages[message.conversationId];
      // On n'insère que dans un fil déjà chargé : sinon la première ouverture rejouerait
      // l'historique avec un trou entre ce message et la page réellement chargée.
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
              // La clé suit le message : sans elle, l'aperçu du fil retomberait sur le
              // `body` anglais alors que la ligne du fil, elle, est bien traduite.
              systemKey: message.systemKey,
              systemVars: message.systemVars,
            },
            lastMessageAt: message.createdAt,
            unread: isOpen ? 0 : conv.unread + 1,
          }),
        });
        if (isOpen) void get().markRead(conv.id);
      } else {
        // Fil inconnu (on vient d'y être ajouté) : la liste complète fait autorité.
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
      /* hors ligne : la liste courante reste affichée */
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
    // L'écho socket arrive aussi à l'auteur : on n'ajoute que si l'événement a été perdu.
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
    // Pas de garde « déjà à zéro » : un message reçu alors que le fil est ouvert est mis
    // à zéro localement dès l'arrivée, et la garde empêchait alors le serveur d'en être
    // informé — le fil ressortait non lu au rechargement suivant.
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
    // `chat:left` fait le ménage local, mais l'auteur du départ ne doit pas attendre
    // l'aller-retour socket pour voir le fil disparaître.
    const rest = { ...get().messages };
    delete rest[id];
    set({
      conversations: get().conversations.filter((c) => c.id !== id),
      messages: rest,
      openId: get().openId === id ? null : get().openId,
    });
  },
}));

/** Total de non-lus, tous fils confondus (pastille du pied de sidebar). */
export const selectUnreadTotal = (s: ChatState): number => s.conversations.reduce((n, c) => n + c.unread, 0);

/**
 * Nom affiché d'un fil : son titre s'il en a un, sinon les participants autres que soi —
 * un tête-à-tête s'appelle par la personne en face, pas « Conversation 12 ».
 */
export function conversationLabel(c: ChatConversation, selfId: number, fallback: string): string {
  if (c.title) return c.title;
  const others = c.members.filter((m) => m.id !== selfId);
  if (others.length === 0) return fallback;
  return others.map((m) => m.displayName).join(', ');
}
