// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { toPublicUser } from '../lib/userView';
import { emitToUser } from './SocketService';
import { sendToUser } from './PushService';
import { getOnlineUserIds } from './PresenceService';

/**
 * Messagerie interne : messages privés et groupes de discussion écrits.
 *
 * Un fil est soit un tête-à-tête (`isGroup: false`, deux membres, dédupliqué : réécrire à
 * quelqu'un rouvre la conversation existante), soit un groupe nommé qui accepte des
 * arrivées et des départs. Les routes ne font que valider → appeler → répondre (10.D8).
 */

/** Identité minimale d'un participant, telle qu'affichée dans un fil. */
export interface ChatUserView {
  id: number;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

const memberIdentity = {
  id: true,
  email: true,
  name: true,
  firstName: true,
  lastName: true,
  username: true,
  avatarKey: true,
} as const;

/** Corps d'un message : borné et non vide une fois les espaces retirés. */
export const MESSAGE_MAX_LENGTH = 4000;

async function toChatUser(raw: {
  id: number;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  avatarKey?: string | null;
}): Promise<ChatUserView> {
  // L'email sert au repli displayName/initials puis repart : la messagerie est ouverte à
  // tous les comptes, y compris aux CLIENT externes — l'annuaire ne leur doit pas les
  // adresses du studio (même raisonnement que `UserService.listPresence`).
  const { displayName, initials, avatarUrl } = await toPublicUser(raw);
  return { id: raw.id, displayName, initials, avatarUrl };
}

/** Vérifie l'appartenance au fil et renvoie l'adhésion (403 sinon : un fil est privé). */
async function requireMembership(conversationId: number, userId: number) {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!membership) throw forbidden('You are not part of this conversation', 'NOT_A_MEMBER');
  return membership;
}

/**
 * Destinataires recevables : comptes réels, hors soi-même et hors comptes de service
 * (un token machine n'a pas d'interlocuteur). Les identifiants inconnus sont refusés
 * plutôt qu'ignorés — sinon un fil se crée en silence avec moins de monde que demandé.
 */
async function resolveTargets(actorId: number, userIds: number[]): Promise<number[]> {
  const unique = [...new Set(userIds)].filter((id) => id !== actorId);
  if (unique.length === 0) throw badRequest('No recipient', 'NO_RECIPIENT');
  const found = await prisma.user.findMany({
    where: { id: { in: unique }, isService: false },
    select: { id: true },
  });
  if (found.length !== unique.length) throw badRequest('Recipient not found', 'BAD_RECIPIENT');
  return unique;
}

// ── Lecture ──────────────────────────────────────────────────────────────────

export interface ConversationView {
  id: number;
  isGroup: boolean;
  /** Nom du groupe ; `null` pour un tête-à-tête (le front affiche l'autre participant). */
  title: string | null;
  members: ChatUserView[];
  lastMessage: { id: number; body: string; authorId: number | null; isSystem: boolean } | null;
  lastMessageAt: Date;
  unread: number;
  muted: boolean;
}

/** Fils de l'utilisateur, du plus récemment actif au plus ancien. */
export async function listConversations(userId: number): Promise<ConversationView[]> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId },
    include: {
      conversation: {
        include: {
          members: { include: { user: { select: memberIdentity } } },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, body: true, authorId: true, isSystem: true },
          },
        },
      },
    },
    orderBy: { conversation: { lastMessageAt: 'desc' } },
  });
  if (memberships.length === 0) return [];

  // Non-lus de TOUS les fils en une requête : un compteur par fil ferait autant d'allers
  // qu'il y a de conversations, à chaque ouverture de la sidebar.
  const unreadRows = await prisma.chatMessage.groupBy({
    by: ['conversationId'],
    where: {
      deletedAt: null,
      authorId: { not: userId },
      OR: memberships.map((m) => ({
        conversationId: m.conversationId,
        createdAt: { gt: m.lastReadAt },
      })),
    },
    _count: { _all: true },
  });
  const unreadByConversation = new Map(unreadRows.map((r) => [r.conversationId, r._count._all]));

  return Promise.all(
    memberships.map(async (m) => ({
      id: m.conversationId,
      isGroup: m.conversation.isGroup,
      title: m.conversation.title,
      members: await Promise.all(m.conversation.members.map((cm) => toChatUser(cm.user))),
      lastMessage: m.conversation.messages[0] ?? null,
      lastMessageAt: m.conversation.lastMessageAt,
      unread: unreadByConversation.get(m.conversationId) ?? 0,
      muted: m.mutedAt != null,
    })),
  );
}

export interface ChatMessageView {
  id: number;
  conversationId: number;
  body: string;
  isSystem: boolean;
  createdAt: Date;
  editedAt: Date | null;
  author: ChatUserView | null;
}

/**
 * Page de messages, du plus ancien au plus récent (ordre de lecture).
 * `before` = id du plus ancien message déjà affiché → remonte le fil.
 */
export async function listMessages(
  conversationId: number,
  userId: number,
  opts: { before?: number; limit?: number } = {},
): Promise<ChatMessageView[]> {
  await requireMembership(conversationId, userId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      deletedAt: null,
      ...(opts.before ? { id: { lt: opts.before } } : {}),
    },
    orderBy: { id: 'desc' },
    take: limit,
    include: { author: { select: memberIdentity } },
  });
  return Promise.all(
    rows.reverse().map(async (m) => ({
      id: m.id,
      conversationId: m.conversationId,
      body: m.body,
      isSystem: m.isSystem,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      author: m.author ? await toChatUser(m.author) : null,
    })),
  );
}

/** Total de messages non lus, tous fils confondus (pastille de la sidebar). */
export async function countUnread(userId: number): Promise<number> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId },
    select: { conversationId: true, lastReadAt: true },
  });
  if (memberships.length === 0) return 0;
  return prisma.chatMessage.count({
    where: {
      deletedAt: null,
      authorId: { not: userId },
      OR: memberships.map((m) => ({
        conversationId: m.conversationId,
        createdAt: { gt: m.lastReadAt },
      })),
    },
  });
}

/**
 * Vue d'un seul fil, du point de vue d'un membre — chacun a ses propres non-lus et sa
 * propre sourdine, la vue n'est donc pas partageable entre destinataires.
 */
export async function conversationViewFor(conversationId: number, userId: number): Promise<ConversationView> {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: {
      conversation: {
        include: {
          members: { include: { user: { select: memberIdentity } } },
          messages: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, body: true, authorId: true, isSystem: true },
          },
        },
      },
    },
  });
  if (!membership) throw notFound('Conversation not found');
  const unread = await prisma.chatMessage.count({
    where: {
      conversationId,
      deletedAt: null,
      authorId: { not: userId },
      createdAt: { gt: membership.lastReadAt },
    },
  });
  return {
    id: conversationId,
    isGroup: membership.conversation.isGroup,
    title: membership.conversation.title,
    members: await Promise.all(membership.conversation.members.map((cm) => toChatUser(cm.user))),
    lastMessage: membership.conversation.messages[0] ?? null,
    lastMessageAt: membership.conversation.lastMessageAt,
    unread,
    muted: membership.mutedAt != null,
  };
}

// ── Écriture ─────────────────────────────────────────────────────────────────

/** Prévient chaque membre d'un changement sur le fil (sa propre vue, avec ses non-lus). */
async function broadcastConversation(conversationId: number, memberIds: number[]): Promise<void> {
  await Promise.all(
    memberIds.map(async (id) =>
      emitToUser(id, 'chat:conversation', { conversation: await conversationViewFor(conversationId, id) }),
    ),
  );
}

/**
 * Ouvre un fil. Un seul destinataire et pas de titre = tête-à-tête : on réutilise le fil
 * existant s'il y en a un, sinon deux personnes qui s'écrivent finissent avec autant de
 * fils que de clics, chacun ne portant qu'une partie de l'historique.
 */
export async function createConversation(
  actorId: number,
  input: { userIds: number[]; title?: string | null },
): Promise<ConversationView> {
  const targets = await resolveTargets(actorId, input.userIds);
  const title = input.title?.trim() || null;
  const soleTarget = targets.length === 1 ? targets[0]! : null;
  const isGroup = soleTarget == null || title != null;

  if (soleTarget != null && !isGroup) {
    const existing = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [{ members: { some: { userId: actorId } } }, { members: { some: { userId: soleTarget } } }],
      },
      select: { id: true },
    });
    if (existing) return conversationViewFor(existing.id, actorId);
  }

  const conversation = await prisma.conversation.create({
    data: {
      isGroup,
      title,
      createdById: actorId,
      members: { create: [actorId, ...targets].map((userId) => ({ userId })) },
    },
    select: { id: true },
  });
  await broadcastConversation(conversation.id, [actorId, ...targets]);
  return conversationViewFor(conversation.id, actorId);
}

/** Poste un message et le pousse en temps réel à tous les membres du fil. */
export async function sendMessage(
  conversationId: number,
  authorId: number,
  rawBody: string,
): Promise<ChatMessageView> {
  await requireMembership(conversationId, authorId);
  const body = rawBody.trim();
  if (!body) throw badRequest('Empty message', 'EMPTY_MESSAGE');
  if (body.length > MESSAGE_MAX_LENGTH) throw badRequest('Message is too long', 'MESSAGE_TOO_LONG');

  const message = await prisma.chatMessage.create({
    data: { conversationId, authorId, body },
    include: { author: { select: memberIdentity } },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: message.createdAt },
  });
  // Écrire vaut lecture : sans ça l'auteur voit sa propre pastille de non-lus grimper.
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: authorId } },
    data: { lastReadAt: message.createdAt },
  });

  const view: ChatMessageView = {
    id: message.id,
    conversationId,
    body: message.body,
    isSystem: false,
    createdAt: message.createdAt,
    editedAt: null,
    author: message.author ? await toChatUser(message.author) : null,
  };
  await fanOutMessage(conversationId, authorId, view);
  return view;
}

/** Diffusion socket + Web Push aux membres hors ligne (sauf fils mis en sourdine). */
async function fanOutMessage(
  conversationId: number,
  authorId: number | null,
  view: ChatMessageView,
): Promise<void> {
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true, mutedAt: true },
  });
  const online = new Set(getOnlineUserIds());
  const label = view.author?.displayName ?? 'ReView';
  for (const m of members) {
    emitToUser(m.userId, 'chat:message', { message: view });
    if (m.userId === authorId || m.mutedAt || online.has(m.userId)) continue;
    sendToUser(m.userId, { title: label, body: view.body.slice(0, 140), url: '/?chat=' + conversationId });
  }
}

/** Marque le fil comme lu jusqu'à maintenant (les autres onglets se synchronisent). */
export async function markRead(conversationId: number, userId: number): Promise<{ unread: number }> {
  await requireMembership(conversationId, userId);
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: new Date() },
  });
  emitToUser(userId, 'chat:read', { conversationId });
  return { unread: await countUnread(userId) };
}

/** Sourdine d'un fil pour soi seul (coupe le Web Push, garde le fil et ses non-lus). */
export async function setMuted(
  conversationId: number,
  userId: number,
  muted: boolean,
): Promise<{ muted: boolean }> {
  await requireMembership(conversationId, userId);
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { mutedAt: muted ? new Date() : null },
  });
  return { muted };
}

/** Message de service (arrivée, départ, renommage) : trace lisible dans le fil. */
async function postSystemMessage(conversationId: number, body: string): Promise<void> {
  const message = await prisma.chatMessage.create({
    data: { conversationId, body, isSystem: true },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: message.createdAt },
  });
  await fanOutMessage(conversationId, null, {
    id: message.id,
    conversationId,
    body: message.body,
    isSystem: true,
    createdAt: message.createdAt,
    editedAt: null,
    author: null,
  });
}

/** Renomme un groupe (un tête-à-tête tire son nom de l'autre participant). */
export async function renameConversation(
  conversationId: number,
  userId: number,
  rawTitle: string,
): Promise<ConversationView> {
  await requireMembership(conversationId, userId);
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw notFound('Conversation not found');
  if (!conversation.isGroup) throw badRequest('A one-to-one conversation cannot be renamed', 'NOT_A_GROUP');
  const title = rawTitle.trim();
  if (!title) throw badRequest('Empty group name', 'EMPTY_TITLE');
  await prisma.conversation.update({ where: { id: conversationId }, data: { title } });
  await postSystemMessage(conversationId, `Le groupe s'appelle désormais « ${title} »`);
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  await broadcastConversation(
    conversationId,
    members.map((m) => m.userId),
  );
  return conversationViewFor(conversationId, userId);
}

/**
 * Ajoute des participants. Un tête-à-tête devient un groupe : les deux personnes n'ont
 * plus un fil privé, l'historique est visible des arrivants — c'est le comportement
 * attendu d'un fil qui s'ouvre, et il est annoncé par un message de service.
 */
export async function addMembers(
  conversationId: number,
  actorId: number,
  userIds: number[],
): Promise<ConversationView> {
  await requireMembership(conversationId, actorId);
  const targets = await resolveTargets(actorId, userIds);
  const already = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { in: targets } },
    select: { userId: true },
  });
  const toAdd = targets.filter((id) => !already.some((m) => m.userId === id));
  if (toAdd.length === 0) throw badRequest('Already members', 'ALREADY_MEMBERS');

  await prisma.$transaction([
    prisma.conversationMember.createMany({
      data: toAdd.map((userId) => ({ conversationId, userId })),
    }),
    prisma.conversation.update({ where: { id: conversationId }, data: { isGroup: true } }),
  ]);
  const names = await prisma.user.findMany({ where: { id: { in: toAdd } }, select: memberIdentity });
  const labels = await Promise.all(names.map(async (u) => (await toChatUser(u)).displayName));
  await postSystemMessage(conversationId, `${labels.join(', ')} a rejoint la conversation`);
  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  await broadcastConversation(
    conversationId,
    members.map((m) => m.userId),
  );
  return conversationViewFor(conversationId, actorId);
}

/**
 * Quitte le fil (ou en retire quelqu'un). Le dernier partant emporte la conversation :
 * un fil sans membre n'est plus lisible par personne, le garder ne ferait qu'accumuler
 * des messages orphelins.
 */
export async function removeMember(
  conversationId: number,
  actorId: number,
  targetId: number,
): Promise<{ left: boolean }> {
  await requireMembership(conversationId, actorId);
  if (targetId !== actorId) {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation?.isGroup) throw badRequest('A one-to-one conversation cannot be left', 'NOT_A_GROUP');
  }
  await requireMembership(conversationId, targetId);
  const label = await prisma.user.findUnique({ where: { id: targetId }, select: memberIdentity });

  await prisma.conversationMember.delete({
    where: { conversationId_userId: { conversationId, userId: targetId } },
  });
  const rest = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  emitToUser(targetId, 'chat:left', { conversationId });
  if (rest.length === 0) {
    await prisma.conversation.delete({ where: { id: conversationId } });
    return { left: true };
  }
  if (label) {
    const { displayName } = await toChatUser(label);
    await postSystemMessage(
      conversationId,
      targetId === actorId ? `${displayName} a quitté la conversation` : `${displayName} a été retiré`,
    );
  }
  await broadcastConversation(
    conversationId,
    rest.map((m) => m.userId),
  );
  return { left: true };
}

/** Suppression douce d'un message — par son auteur uniquement. */
export async function deleteMessage(messageId: number, userId: number): Promise<void> {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt) throw notFound('Message not found');
  if (message.authorId !== userId) throw forbidden('Only the author can delete their message');
  await prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
  const members = await prisma.conversationMember.findMany({
    where: { conversationId: message.conversationId },
    select: { userId: true },
  });
  for (const m of members) {
    emitToUser(m.userId, 'chat:deleted', { conversationId: message.conversationId, messageId });
  }
}
