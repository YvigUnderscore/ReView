// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    conversation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    conversationMember: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    chatMessage: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock('./SocketService', () => ({ emitToUser: vi.fn() }));
vi.mock('./PushService', () => ({ sendToUser: vi.fn() }));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: () => [] }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: class {},
}));

import { createConversation, sendMessage } from './ChatService';
import { prisma } from '../lib/prisma';
import { emitToUser } from './SocketService';
import { sendToUser } from './PushService';

const db = vi.mocked(prisma, true);

/** Vue minimale d'un fil, telle que la relit `conversationViewFor` après écriture. */
const membershipRow = (conversationId: number, memberIds: number[]) => ({
  conversationId,
  userId: memberIds[0],
  lastReadAt: new Date(0),
  mutedAt: null,
  conversation: {
    isGroup: memberIds.length > 2,
    title: null,
    lastMessageAt: new Date(0),
    members: memberIds.map((id) => ({ user: { id, email: `u${id}@x.io`, username: `u${id}` } })),
    messages: [],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([{ id: 2 }] as never);
  db.chatMessage.count.mockResolvedValue(0);
  db.conversationMember.findUnique.mockResolvedValue(membershipRow(7, [1, 2]) as never);
  db.conversationMember.findMany.mockResolvedValue([{ userId: 1 }, { userId: 2 }] as never);
  db.conversation.create.mockResolvedValue({ id: 7 } as never);
  db.conversation.findFirst.mockResolvedValue(null);
});

describe('ChatService.createConversation', () => {
  it('rouvre le tête-à-tête existant au lieu d’en créer un second', async () => {
    db.conversation.findFirst.mockResolvedValue({ id: 7 } as never);
    const view = await createConversation(1, { userIds: [2] });
    expect(db.conversation.create).not.toHaveBeenCalled();
    expect(view.id).toBe(7);
  });

  it('crée un tête-à-tête avec les deux membres', async () => {
    await createConversation(1, { userIds: [2] });
    expect(db.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isGroup: false,
          members: { create: [{ userId: 1 }, { userId: 2 }] },
        }),
      }),
    );
  });

  it('marque le fil comme groupe dès qu’un titre est donné', async () => {
    await createConversation(1, { userIds: [2], title: 'Séquence 12' });
    expect(db.conversation.create.mock.calls[0]![0].data).toMatchObject({
      isGroup: true,
      title: 'Séquence 12',
    });
    // Un groupe nommé ne doit jamais recycler un tête-à-tête existant.
    expect(db.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('refuse un destinataire inconnu plutôt que de l’ignorer en silence', async () => {
    db.user.findMany.mockResolvedValue([{ id: 2 }] as never);
    await expect(createConversation(1, { userIds: [2, 999] })).rejects.toThrow(/introuvable/i);
  });

  it('refuse un fil avec soi-même pour seul destinataire', async () => {
    await expect(createConversation(1, { userIds: [1] })).rejects.toThrow(/destinataire/i);
  });
});

describe('ChatService.sendMessage', () => {
  beforeEach(() => {
    db.chatMessage.create.mockResolvedValue({
      id: 42,
      conversationId: 7,
      body: 'Bonjour',
      createdAt: new Date('2026-08-10T10:00:00Z'),
      author: { id: 1, email: 'u1@x.io', username: 'u1' },
    } as never);
  });

  it('refuse un message vide (espaces seuls)', async () => {
    await expect(sendMessage(7, 1, '   ')).rejects.toThrow(/vide/i);
  });

  it('refuse d’écrire dans un fil dont on n’est pas membre', async () => {
    db.conversationMember.findUnique.mockResolvedValue(null);
    await expect(sendMessage(7, 3, 'Coucou')).rejects.toThrow(/participez pas/i);
  });

  it('pousse le message à tous les membres et remonte le fil', async () => {
    await sendMessage(7, 1, 'Bonjour');
    expect(db.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 }, data: { lastMessageAt: expect.any(Date) } }),
    );
    expect(vi.mocked(emitToUser).mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [1, 'chat:message'],
      [2, 'chat:message'],
    ]);
  });

  it('n’envoie pas de notification push à l’auteur du message', async () => {
    await sendMessage(7, 1, 'Bonjour');
    const pushed = vi.mocked(sendToUser).mock.calls.map((c) => c[0]);
    expect(pushed).not.toContain(1);
    expect(pushed).toContain(2);
  });

  it('se compte comme lu pour l’auteur', async () => {
    await sendMessage(7, 1, 'Bonjour');
    expect(db.conversationMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId_userId: { conversationId: 7, userId: 1 } },
      }),
    );
  });
});
