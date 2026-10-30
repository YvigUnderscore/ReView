// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { toPublicUser } from '../lib/userView';
import { getDefaultLocale } from '../lib/settings';
import { localeFromPreferences, t, BASE_LOCALE, type Locale, type MessageKey, type TParams } from '../i18n';
import { emitToUser } from './SocketService';
import { sendToUser } from './PushService';
import { getOnlineUserIds } from './PresenceService';

/**
 * Internal messaging: private messages and written discussion groups.
 *
 * A thread is either a one-to-one conversation (`isGroup: false`, two members, deduplicated: writing to
 * someone reopens the existing conversation), or a named group that accepts arrivals and departures. The
 * routes only validate, call and respond (10.D8).
 */

/** Minimal identity of a participant, as displayed in a thread. */
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

/** Body of a message: bounded, and non-empty once whitespace is removed. */
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
  // The email is used for the displayName/initials fallback and then dropped: messaging is open to all
  // accounts, including external CLIENTs; the directory must not expose studio addresses to them (same
  // reasoning as `UserService.listPresence`).
  const { displayName, initials, avatarUrl } = await toPublicUser(raw);
  return { id: raw.id, displayName, initials, avatarUrl };
}

/**
 * Sentence of a service message: an i18n key and variables, never text.
 *
 * It used to be written in French IN THE DATABASE at the time of the event, then served as is: once stored,
 * nothing could translate it again. The thread now carries the key and its variables (same mechanism as
 * `ShotgridSyncLog`), and each reader sees it in their own language.
 */
interface SystemPhrase {
  key: MessageKey;
  vars: TParams;
}

/** Columns that carry the sentence of a message, written or service. */
const messagePhrase = { body: true, isSystem: true, systemKey: true, systemVars: true } as const;

/**
 * Variables re-read from the database. The column is free-form JSON: an array or a scalar would interpolate
 * nothing, so return `null` and let the fallback do its job.
 */
function toSystemVars(raw: Prisma.JsonValue | null): TParams | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as TParams) : null;
}

/** Checks membership in the thread and returns the membership (403 otherwise: a thread is private). */
async function requireMembership(conversationId: number, userId: number) {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!membership) throw forbidden('You are not part of this conversation', 'NOT_A_MEMBER');
  return membership;
}

/**
 * Acceptable recipients: real accounts, excluding oneself and service accounts (a machine token has no one to
 * talk to). Unknown identifiers are refused rather than ignored, otherwise a thread would be created silently
 * with fewer people than requested.
 *
 * A CLIENT is confined to the people of their projects, exactly like the directory of
 * `UserService.listPresence`: an external contributor has no business knowing the whole team or being able to
 * write to anyone. Without this check, the restricted directory was enforced for reads only: posting an
 * arbitrary identifier to the chat route opened a one-to-one conversation with any internal account, or
 * enrolled it in a group.
 *
 * The role is re-read here rather than passed down from the routes: `resolveTargets` is the only common path
 * for opening a thread and adding members, so no entry point can forget it (same reason as the membership
 * checked in the service).
 */
async function resolveTargets(actorId: number, userIds: number[]): Promise<number[]> {
  const unique = [...new Set(userIds)].filter((id) => id !== actorId);
  if (unique.length === 0) throw badRequest('No recipient', 'NO_RECIPIENT');
  const [actor, found] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { role: true } }),
    prisma.user.findMany({ where: { id: { in: unique }, isService: false }, select: { id: true } }),
  ]);
  if (found.length !== unique.length) throw badRequest('Recipient not found', 'BAD_RECIPIENT');
  if (actor?.role !== Role.CLIENT) return unique;

  const shared = await prisma.user.findMany({
    where: {
      id: { in: unique },
      memberships: { some: { project: { memberships: { some: { userId: actorId } } } } },
    },
    select: { id: true },
  });
  if (shared.length !== unique.length) {
    // A named refusal, not a silent filter: the requested thread is not stripped of a few recipients without
    // the caller knowing.
    const refused = unique.filter((id) => !shared.some((u) => u.id === id));
    throw forbidden(`Recipient outside your projects: ${refused.join(', ')}`, 'RECIPIENT_OUT_OF_SCOPE');
  }
  return unique;
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** Last message of a thread, as displayed under the thread name in the list. */
export interface LastMessageView {
  id: number;
  body: string;
  authorId: number | null;
  isSystem: boolean;
  systemKey: string | null;
  systemVars: TParams | null;
}

export interface ConversationView {
  id: number;
  isGroup: boolean;
  /** Group name; `null` for a one-to-one conversation (the front end shows the other participant). */
  title: string | null;
  members: ChatUserView[];
  lastMessage: LastMessageView | null;
  lastMessageAt: Date;
  unread: number;
  muted: boolean;
}

/** The last message as the database returns it, with `systemVars` reformatted. */
function toLastMessage(
  row: (Omit<LastMessageView, 'systemVars'> & { systemVars: Prisma.JsonValue }) | undefined,
): LastMessageView | null {
  return row ? { ...row, systemVars: toSystemVars(row.systemVars) } : null;
}

/** The user's threads, from most recently active to oldest. */
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
            select: { id: true, authorId: true, ...messagePhrase },
          },
        },
      },
    },
    orderBy: { conversation: { lastMessageAt: 'desc' } },
  });
  if (memberships.length === 0) return [];

  // Unread counts for ALL threads in one query: a counter per thread would make as many round trips as there
  // are conversations, on every opening of the sidebar.
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
      lastMessage: toLastMessage(m.conversation.messages[0]),
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
  /** i18n key of a service message and its variables — `null` for a written message. */
  systemKey: string | null;
  systemVars: TParams | null;
  createdAt: Date;
  editedAt: Date | null;
  author: ChatUserView | null;
}

/**
 * Page of messages, from oldest to most recent (reading order). `before` = id of the oldest message already
 * displayed → scrolls the thread back.
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
      systemKey: m.systemKey,
      systemVars: toSystemVars(m.systemVars),
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      author: m.author ? await toChatUser(m.author) : null,
    })),
  );
}

/** Total unread messages across all threads (sidebar badge). */
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
 * View of a single thread, from the point of view of a member: each has their own unread count and their own
 * mute, so the view cannot be shared between recipients.
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
            select: { id: true, authorId: true, ...messagePhrase },
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
    lastMessage: toLastMessage(membership.conversation.messages[0]),
    lastMessageAt: membership.conversation.lastMessageAt,
    unread,
    muted: membership.mutedAt != null,
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** Notifies each member of a change on the thread (their own view, with their unread counts). */
async function broadcastConversation(conversationId: number, memberIds: number[]): Promise<void> {
  await Promise.all(
    memberIds.map(async (id) =>
      emitToUser(id, 'chat:conversation', { conversation: await conversationViewFor(conversationId, id) }),
    ),
  );
}

/**
 * Opens a thread. A single recipient and no title = one-to-one: the existing thread is reused if there is
 * one, otherwise two people writing to each other end up with as many threads as clicks, each holding only
 * part of the history.
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

/** Posts a message and pushes it in real time to all members of the thread. */
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
  // Writing counts as reading: without this, the author would see their own unread badge climb.
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: authorId } },
    data: { lastReadAt: message.createdAt },
  });

  const view: ChatMessageView = {
    id: message.id,
    conversationId,
    body: message.body,
    isSystem: false,
    systemKey: null,
    systemVars: null,
    createdAt: message.createdAt,
    editedAt: null,
    author: message.author ? await toChatUser(message.author) : null,
  };
  await fanOutMessage(conversationId, authorId, view);
  return view;
}

/** Socket broadcast + Web Push to offline members (except threads muted for them). */
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
  // A service message has no text of its own: the interface translates it at render time. The browser
  // notification, however, leaves the application and escapes any catalogue: it is here, and nowhere else,
  // that it takes its recipient's language. Preferences are only read in that case: a written message goes
  // out as typed.
  const locales = view.systemKey ? await localesOf(members.map((m) => m.userId)) : null;
  for (const m of members) {
    emitToUser(m.userId, 'chat:message', { message: view });
    if (m.userId === authorId || m.mutedAt || online.has(m.userId)) continue;
    const body = locales
      ? t(locales.get(m.userId) ?? BASE_LOCALE, view.systemKey as MessageKey, view.systemVars ?? undefined)
      : view.body;
    sendToUser(m.userId, { title: label, body: body.slice(0, 140), url: '/?chat=' + conversationId });
  }
}

/** Language of each recipient: their preference, otherwise the studio's — in two queries. */
async function localesOf(userIds: number[]): Promise<Map<number, Locale>> {
  const [rows, fallback] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, preferences: true } }),
    getDefaultLocale(),
  ]);
  return new Map(rows.map((u) => [u.id, localeFromPreferences(u.preferences) ?? fallback]));
}

/** Marks the thread as read up to now (other tabs sync accordingly). */
export async function markRead(conversationId: number, userId: number): Promise<{ unread: number }> {
  await requireMembership(conversationId, userId);
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: new Date() },
  });
  emitToUser(userId, 'chat:read', { conversationId });
  return { unread: await countUnread(userId) };
}

/** Mutes a thread for oneself only (cuts Web Push, keeps the thread and its unread counts). */
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

/**
 * Service message (arrival, departure, rename): a readable trace in the thread.
 *
 * The key and its variables are recorded, not the sentence. `body` is too, **in English**: messages posted
 * before this change have no key, and it is what still displays them: an tab older than the server falls back
 * to it the same way.
 */
async function postSystemMessage(conversationId: number, phrase: SystemPhrase): Promise<void> {
  const message = await prisma.chatMessage.create({
    data: {
      conversationId,
      body: t(BASE_LOCALE, phrase.key, phrase.vars),
      isSystem: true,
      systemKey: phrase.key,
      systemVars: phrase.vars,
    },
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
    systemKey: phrase.key,
    systemVars: phrase.vars,
    createdAt: message.createdAt,
    editedAt: null,
    author: null,
  });
}

/** Renames a group (a one-to-one takes its name from the other participant). */
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
  await postSystemMessage(conversationId, { key: 'chat.system.renamed', vars: { title } });
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
 * Adds participants. A one-to-one becomes a group: the two people no longer have a private thread, and the
 * history is visible to newcomers — the expected behaviour of a thread that is being opened, and it is
 * announced by a service message.
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
  // `count` selects the plural form: "X joined" / "X and Y joined". Agreement is decided in each language; it
  // cannot be decided here.
  await postSystemMessage(conversationId, {
    key: 'chat.system.joined',
    vars: { names: labels.join(', '), count: labels.length },
  });
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
 * Leaves the thread (or removes someone from it). The last departing member takes the conversation with them:
 * a thread with no member is no longer readable by anyone, and keeping it would only accumulate orphan
 * messages.
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
    await postSystemMessage(conversationId, {
      key: targetId === actorId ? 'chat.system.left' : 'chat.system.removed',
      vars: { name: displayName },
    });
  }
  await broadcastConversation(
    conversationId,
    rest.map((m) => m.userId),
  );
  return { left: true };
}

/** Soft-deletes a message — by its author only. */
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
