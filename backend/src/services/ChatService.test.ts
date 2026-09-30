// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    conversation: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    conversationMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
      delete: vi.fn(),
    },
    chatMessage: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    setting: { findUnique: vi.fn() },
  },
}));
vi.mock('./SocketService', () => ({ emitToUser: vi.fn() }));
vi.mock('./PushService', () => ({ sendToUser: vi.fn() }));
vi.mock('./PresenceService', () => ({ getOnlineUserIds: () => [] }));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn() },
  StorageService: class {},
}));

import { Role } from '@prisma/client';
import { addMembers, createConversation, removeMember, renameConversation, sendMessage } from './ChatService';
import { prisma } from '../lib/prisma';
import { t } from '../i18n';
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
    await expect(createConversation(1, { userIds: [2, 999] })).rejects.toThrow(/not found/i);
  });

  it('refuse un fil avec soi-même pour seul destinataire', async () => {
    await expect(createConversation(1, { userIds: [1] })).rejects.toThrow(/recipient/i);
  });
});

/** Les deux `where` que `resolveTargets` envoie : le second porte le filtre par projet. */
type TargetQuery = { where: { id: { in: number[] }; memberships?: unknown } };

describe('ChatService.createConversation — cloisonnement d’un CLIENT', () => {
  /**
   * Acteur CLIENT dont les projets ne recoupent que `sharedIds` : la requête portant le
   * filtre `memberships` ne renvoie que ceux-là, l'autre voit tout le monde.
   */
  const asClient = (sharedIds: number[]) => {
    db.user.findUnique.mockResolvedValue({ role: Role.CLIENT } as never);
    db.user.findMany.mockImplementation(((args: TargetQuery) => {
      const ids = args.where.id.in;
      const kept = args.where.memberships ? ids.filter((id) => sharedIds.includes(id)) : ids;
      return Promise.resolve(kept.map((id) => ({ id })));
    }) as never);
  };

  it('laisse un CLIENT écrire à quelqu’un d’un projet partagé', async () => {
    asClient([2]);
    const view = await createConversation(1, { userIds: [2] });
    expect(view.id).toBe(7);
    expect(db.conversation.create).toHaveBeenCalled();
  });

  it('refuse à un CLIENT un compte interne hors de ses projets', async () => {
    // Refus nommé (403) et non filtrage silencieux : l'identifiant écarté est dit.
    asClient([]);
    await expect(createConversation(1, { userIds: [2] })).rejects.toMatchObject({
      statusCode: 403,
      code: 'RECIPIENT_OUT_OF_SCOPE',
      message: expect.stringContaining('2'),
    });
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it('ne restreint pas un compte interne', async () => {
    db.user.findUnique.mockResolvedValue({ role: Role.SUPERVISOR } as never);
    await createConversation(1, { userIds: [2] });
    const queries = db.user.findMany.mock.calls.map((c) => c[0] as TargetQuery);
    expect(queries.some((q) => q.where.memberships)).toBe(false);
    expect(db.conversation.create).toHaveBeenCalled();
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
    await expect(sendMessage(7, 1, '   ')).rejects.toThrow(/empty message/i);
  });

  it('refuse d’écrire dans un fil dont on n’est pas membre', async () => {
    db.conversationMember.findUnique.mockResolvedValue(null);
    await expect(sendMessage(7, 3, 'Coucou')).rejects.toThrow(/not part of this conversation/i);
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

/**
 * Messages de service (arrivée, départ, renommage). La phrase était écrite en français EN
 * BASE : une fois enregistrée, plus rien ne pouvait la retraduire. Ce qui compte ici est
 * donc ce qui atteint la colonne — une clé et ses variables, jamais une phrase française.
 */
describe('ChatService — messages de service', () => {
  /** Données du `chatMessage.create` du message de service (le seul créé par ces flux). */
  const systemData = () => db.chatMessage.create.mock.calls[0]![0].data as Record<string, unknown>;

  beforeEach(() => {
    db.chatMessage.create.mockImplementation((({ data }: { data: { body: string } }) =>
      Promise.resolve({ id: 99, conversationId: 7, body: data.body, createdAt: new Date(0) })) as never);
    db.conversation.findUnique.mockResolvedValue({ id: 7, isGroup: true } as never);
    db.conversationMember.findMany.mockResolvedValue([
      { userId: 1, mutedAt: null },
      { userId: 2, mutedAt: null },
    ] as never);
    db.setting.findUnique.mockResolvedValue(null);
    db.user.findMany.mockResolvedValue([] as never);
  });

  it('enregistre la clé du renommage et son titre, et un corps anglais', async () => {
    await renameConversation(7, 1, 'Séquence 12');
    expect(systemData()).toMatchObject({
      isSystem: true,
      systemKey: 'chat.system.renamed',
      systemVars: { title: 'Séquence 12' },
      body: 'The group is now called « Séquence 12 »',
    });
  });

  it('accorde l’arrivée sur le nombre d’arrivants (`count`)', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 3, email: 'u3@x.io', username: 'nina' },
      { id: 4, email: 'u4@x.io', username: 'sacha' },
    ] as never);
    await addMembers(7, 1, [3, 4]);
    expect(systemData()).toMatchObject({
      systemKey: 'chat.system.joined',
      systemVars: { names: 'nina, sacha', count: 2 },
      body: 'nina, sacha joined the conversation',
    });
  });

  it('distingue un départ volontaire d’un retrait', async () => {
    db.user.findUnique.mockResolvedValue({ id: 1, email: 'u1@x.io', username: 'nina' } as never);
    await removeMember(7, 1, 1);
    expect(systemData()).toMatchObject({
      systemKey: 'chat.system.left',
      systemVars: { name: 'nina' },
    });

    vi.clearAllMocks();
    db.conversationMember.findUnique.mockResolvedValue(membershipRow(7, [1, 2]) as never);
    db.conversationMember.findMany.mockResolvedValue([{ userId: 1, mutedAt: null }] as never);
    db.conversation.findUnique.mockResolvedValue({ id: 7, isGroup: true } as never);
    db.chatMessage.create.mockResolvedValue({ id: 99, body: '', createdAt: new Date(0) } as never);
    db.user.findUnique.mockResolvedValue({ id: 2, email: 'u2@x.io', username: 'sacha' } as never);
    db.user.findMany.mockResolvedValue([] as never);
    await removeMember(7, 1, 2);
    expect(systemData()).toMatchObject({
      systemKey: 'chat.system.removed',
      systemVars: { name: 'sacha' },
    });
  });

  it('pousse la notification navigateur dans la langue de chaque destinataire', async () => {
    // Le Web Push sort de l'application : il échappe au catalogue du navigateur. Sans
    // cette résolution, tout le monde recevait la phrase du serveur.
    db.user.findMany.mockResolvedValue([
      { id: 1, preferences: { locale: 'ja' } },
      { id: 2, preferences: {} },
    ] as never);
    db.setting.findUnique.mockResolvedValue({ value: 'fr' } as never); // défaut du studio
    await renameConversation(7, 1, 'Séquence 12');
    const bodies = new Map(vi.mocked(sendToUser).mock.calls.map((c) => [c[0], c[1].body]));
    expect(bodies.get(1)).toBe(t('ja', 'chat.system.renamed', { title: 'Séquence 12' }));
    expect(bodies.get(2)).toBe(t('fr', 'chat.system.renamed', { title: 'Séquence 12' }));
  });
});
