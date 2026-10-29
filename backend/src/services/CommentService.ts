// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CommentState, Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sanitizeHtml } from '../lib/sanitize';
import { emitToProject } from './SocketService';
import { notify, sendDiscord } from './NotificationService';
import { toPublicUser, toPublicUserOrDeleted } from '../lib/userView';
import { storage } from './StorageService';
import * as ReviewReferenceService from './ReviewReferenceService';
import { notifyWatchers } from './WatchService';
import { publish as publishApiEvent } from './ApiEventService';
import { assertProjectWritable } from '../lib/projectGuard';
import { badRequest, forbidden } from '../lib/errors';
import { parseAnnotation, parseCameraState, parseGuestAnnotation } from '../lib/commentPayload';
import { assertSplatEditBlobs } from '../lib/commentSplatEdit';
import {
  attachmentKeys,
  filterAttachments,
  orphanedKeys,
  ownAttachmentPrefix,
  shotgridAttachmentPrefix,
  type AttachmentRef,
} from '../lib/commentAttachments';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import { assertAssignable } from './EntityAssigneeService';

/**
 * Business logic for review comments (thread, author/attachment enrichment, reactions, notifications).
 * Project access (RBAC) is asserted in the route; these functions receive the already resolved and verified
 * projectId (10.D8).
 */

type SessionUser = { id: number; role: Role };

const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

const userSelect = {
  select: {
    id: true,
    name: true,
    email: true,
    firstName: true,
    lastName: true,
    username: true,
    avatarKey: true,
  },
} as const;

const commentInclude = {
  author: userSelect,
  resolvedBy: userSelect,
  reactions: { select: { id: true, emoji: true, userId: true } },
} as const;

// Replaces the raw author with a public view (displayName, initials, presigned avatarUrl).
type RawAuthor = {
  id: number;
  name: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  avatarKey: string | null;
};
type RawAttachment = { key: string; name?: string; contentType?: string };
interface RawComment {
  author: RawAuthor;
  /** Name of who wrote here without an account: a guest, or a contributor coming from ShotGrid. */
  guestName?: string | null;
  resolvedBy?: RawAuthor | null;
  replies?: RawComment[];
  attachments?: unknown;
  [k: string]: unknown;
}

// Resolves attachments (MinIO keys) into presigned, displayable URLs. The response's `Content-Type` is
// enforced: the stored type comes from the browser at the time of the presigned PUT (which the signature does
// not constrain), so a file uploaded as `text/html` would run on the application's origin when someone opens
// the link. We restart from the type recorded when the comment was created, itself filtered by the route.
async function resolveAttachments(attachments: unknown): Promise<unknown> {
  if (!Array.isArray(attachments)) return attachments ?? undefined;
  return Promise.all(
    (attachments as RawAttachment[]).map(async (a) => ({
      ...a,
      url: a.key ? await storage.getPresignedGetUrl(a.key, 3600, a.contentType).catch(() => null) : null,
    })),
  );
}

/**
 * Attachments ready for a PUBLIC surface (client portal): the presigned URL, the name and the type — never
 * the MinIO key. The client thread finally displays the images the studio attaches to it; it has no need to
 * know where the object lives, since that would be used to sign others.
 */
export async function publicAttachments(
  attachments: unknown,
): Promise<{ name?: string; contentType?: string; url: string | null }[]> {
  if (!Array.isArray(attachments)) return [];
  return Promise.all(
    (attachments as RawAttachment[]).map(async (a) => ({
      name: a.name,
      contentType: a.contentType,
      url: a.key ? await storage.getPresignedGetUrl(a.key, 3600, a.contentType).catch(() => null) : null,
    })),
  );
}

async function enrichComment(c: RawComment): Promise<Record<string, unknown>> {
  return {
    ...c,
    // The author may be `null`: the relation is SetNull, so a deleted account leaves its comments behind.
    // Dereferencing it used to break the whole thread with a 500. `guestName` tells a deleted account apart
    // from someone who never had one.
    author: await toPublicUserOrDeleted(c.author, c.guestName),
    resolvedBy: c.resolvedBy ? await toPublicUser(c.resolvedBy) : null,
    attachments: await resolveAttachments(c.attachments),
    replies: c.replies ? await Promise.all(c.replies.map(enrichComment)) : undefined,
  };
}
const asRawComment = (c: unknown) => c as RawComment;

/**
 * A media's comment thread (paginated roots + nested replies), enriched.
 *
 * Feedback written from an edit stays there: it only appears here once explicitly sent back (Phase 46). An
 * edit is read shot by shot and produces many cut notes; dumping them by default into the artist's review
 * would drown the feedback addressed to them.
 */
export async function listThread(
  mediaObjectId: number,
  p: PaginationParams,
  viewerRole?: Role,
): Promise<Paginated<unknown>> {
  // A CLIENT only sees what is explicitly meant for them, here as everywhere else (public sharing, search,
  // export). This was the only read of the thread that omitted it: a client who was a project member
  // therefore read all internal notes from the application.
  const clientScope = viewerRole === Role.CLIENT ? { isVisibleToClient: true } : {};
  const where = {
    mediaObjectId,
    parentId: null,
    ...clientScope,
    OR: [{ timelineId: null }, { sharedToShot: true }],
  };
  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
      ...pageArgs(p),
      include: {
        ...commentInclude,
        replies: {
          where: clientScope,
          orderBy: { createdAt: 'asc' },
          include: commentInclude,
        },
      },
    }),
    prisma.comment.count({ where }),
  ]);
  const items = await Promise.all(comments.map((c) => enrichComment(asRawComment(c))));
  return paginate(items, total, p);
}

/**
 * An edit's thread (Phase 46): the feedback placed on the film, in its own order.
 *
 * The order is that of `timelineTime` — the position in the whole edit — not that of each shot's timecode: on
 * a single timeline, two feedbacks from different shots only make sense relative to each other on this scale.
 */
export async function listMontage(timelineId: number, p: PaginationParams): Promise<Paginated<unknown>> {
  const where = { timelineId, parentId: null };
  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: [{ timelineTime: 'asc' }, { createdAt: 'asc' }],
      ...pageArgs(p),
      include: { ...commentInclude, replies: { orderBy: { createdAt: 'asc' }, include: commentInclude } },
    }),
    prisma.comment.count({ where }),
  ]);
  const items = await Promise.all(comments.map((c) => enrichComment(asRawComment(c))));
  return paginate(items, total, p);
}

/** Presigned PUT URL for an image attached to the thread. */
export async function presignAttachment(userId: number, filename: string, contentType: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `comments/attachments/${userId}/${Date.now()}-${safe}`;
  const url = await storage.getPresignedPutUrl(key, contentType, 900);
  return { url, key };
}

/** `@xxx` tokens of a text (mentions 32.B) — de-duplicated, lowercased. */
export function extractMentionTokens(content: string): string[] {
  const tokens = [...content.matchAll(/(^|[\s([{.,;:!?'"«»])@([a-zA-Z0-9._-]+)/g)].map((m) =>
    m[2]!.toLowerCase(),
  );
  return [...new Set(tokens)];
}

/**
 * Notifies the project members mentioned by `@username` (or the `@local-part` of the email for accounts
 * without a handle). The comment's author is excluded.
 */
async function notifyMentions(
  actorId: number,
  projectId: number,
  mediaObjectId: number,
  content: string,
): Promise<number[]> {
  const tokens = extractMentionTokens(content);
  if (tokens.length === 0) return [];
  const members = await prisma.projectMembership.findMany({
    where: { projectId },
    select: { user: { select: { id: true, username: true, email: true } } },
  });
  const targets = members
    .map((m) => m.user)
    .filter((u) => {
      if (u.id === actorId) return false;
      const handles = [u.username, u.email.split('@')[0]].filter(Boolean) as string[];
      return handles.some((h) => tokens.includes(h.toLowerCase()));
    });
  await Promise.all(
    targets.map((u) =>
      notify({
        userId: u.id,
        kind: 'mention',
        messageKey: 'notification.mentioned',
        projectId,
        referenceId: mediaObjectId,
      }),
    ),
  );
  return targets.map((u) => u.id);
}

export interface CreateCommentInput {
  mediaObjectId: number;
  content: string;
  timestamp?: number;
  duration?: number;
  annotation?: unknown;
  cameraState?: unknown;
  attachments?: AttachmentRef[];
  parentId?: number;
  /** Feedback written from an edit: it belongs to that edit (Phase 46). */
  timelineId?: number;
  /** Position within the whole edit (s) — `timestamp` remains the position within the shot. */
  timelineTime?: number;
}

export async function create(user: SessionUser, projectId: number, body: CreateCommentInput) {
  await assertProjectWritable(projectId); // 38.B: archived project = read-only
  // Security: the attachment key is supplied by the client, and later used to sign a read URL. We therefore
  // only accept the folder THIS user could fill via `presignAttachment`: the global folder would let one
  // attach (and thus read) another user's attachment, on another project.
  const attachments = filterAttachments(body.attachments, [ownAttachmentPrefix(user.id)]);

  // A reply must target a comment on the same media.
  if (body.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: body.parentId },
      select: { mediaObjectId: true },
    });
    if (!parent || parent.mediaObjectId !== body.mediaObjectId) throw badRequest('Invalid parent comment');
  }

  // Security: the targeted edit is supplied by the client, and the route only authorized the MEDIA's project.
  // Copying `timelineId` as is let one write into the edit notes of a neighbouring project — refused for
  // reading (403), but open for writing, under the author's name. Edit identifiers are small, sequential
  // integers.
  if (body.timelineId != null) {
    const timeline = await prisma.timeline.findUnique({
      where: { id: body.timelineId },
      select: { projectId: true },
    });
    if (!timeline || timeline.projectId !== projectId) throw badRequest('Invalid timeline');
  } else if (body.timelineTime != null) {
    // A position in the edit without an edit designates nothing: we refuse rather than persist an orphan
    // value.
    throw badRequest('timelineTime requires timelineId');
  }

  // JSON blobs re-read here and not only at the route: their shape and volume are bounded for every caller of
  // the service (see `lib/commentPayload`).
  const annotation = parseAnnotation(body.annotation);
  const cameraState = parseCameraState(body.cameraState);
  // Cloud-edit proposal (batch 14): its two blobs must be attachments of THIS comment, exist, and fit under
  // the media-mask ceiling. The list of attachments has already been filtered by prefix — so it is that list
  // which carries ownership, and the purge that re-reads it will collect the blobs like the rest.
  await assertSplatEditBlobs(annotation, {
    attachedKeys: attachments.map((a) => a.key),
    stat: (key) => storage.statObject(key),
  });

  const comment = await prisma.comment.create({
    data: {
      mediaObjectId: body.mediaObjectId,
      userId: user.id,
      content: sanitizeHtml(body.content),
      timestamp: body.timestamp ?? null,
      duration: body.duration ?? null,
      annotation: annotation ?? undefined,
      cameraState: cameraState ?? undefined,
      attachments: attachments.length > 0 ? (attachments as object) : undefined,
      parentId: body.parentId ?? null,
      timelineId: body.timelineId ?? null,
      timelineTime: body.timelineTime ?? null,
    },
    include: commentInclude,
  });
  const enriched = await enrichComment(asRawComment(comment));
  emitToProject(projectId, 'comment:new', enriched);
  // Outgoing webhooks (36.D) + API v1 event journal.
  publishApiEvent('comment.created', {
    projectId,
    entityType: 'comment',
    entityId: comment.id,
    actorId: user.id,
    payload: {
      commentId: comment.id,
      mediaObjectId: body.mediaObjectId,
      projectId,
      authorId: user.id,
      parentId: body.parentId ?? null,
      timestamp: body.timestamp ?? null,
    },
  });

  // 48: the feedback also goes to ShotGrid, as a note attached to the version, with the annotated frame as an
  // attachment. A reply within a thread stays local — ShotGrid has no notion of thread matching ours.
  if (!body.parentId)
    await enqueuePush(projectId, { type: 'comment', commentId: comment.id, actorId: user.id });

  // @user mentions (32.B): targeted notification of the members cited.
  const mentioned = await notifyMentions(user.id, projectId, body.mediaObjectId, comment.content);

  // Notifications: reply -> author of the parent comment (unless already notified by mention); otherwise a
  // project Discord ping.
  if (body.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: body.parentId },
      select: { userId: true },
    });
    if (parent?.userId && parent.userId !== user.id && !mentioned.includes(parent.userId)) {
      // referenceId = media (not the comment) -> navigable to the review on the front end (10.C5).
      await notify({
        userId: parent.userId,
        kind: 'reply',
        messageKey: 'notification.reply',
        projectId,
        referenceId: body.mediaObjectId,
      });
    }
  } else if (body.timelineId) {
    // Edit feedback: the shot's followers are not alerted, since the feedback does not yet appear in their
    // review. It is `share` that alerts them.
    void sendDiscord('chat.montageComment', { project: projectId });
  } else {
    // Followers (32.G): new root comment on the version/shot/asset chain.
    await notifyWatchers({
      mediaObjectId: body.mediaObjectId,
      projectId,
      messageKey: 'notification.watchedComment',
      exclude: [user.id, ...mentioned],
    });
    void sendDiscord('chat.newComment', { project: projectId });
  }
  return enriched;
}

/**
 * A guest writing from a sharing link: they have no account, hence no rights.
 *
 * They cannot mention (the text is not scanned for `@`), assign, resolve, reply, or attach a file — otherwise
 * the public link would become a write surface on the project. What remains is exactly what is expected of
 * them: a dated feedback, visible to the client, on a media they are allowed to see.
 */
export interface GuestActor {
  /** Name entered on the public page. No account corresponds to it. */
  name: string;
  /** Link used — recorded in the API event, the guest's only audit trail. */
  shareLinkId: number;
  /**
   * Who created the link. Alerted even if they do not follow the shot: it is they who solicited the client,
   * and without this a feedback may reach no one (followers are a voluntary subscription, often empty on a
   * delivered shot).
   */
  shareOwnerId?: number | null;
}

export interface CreateGuestCommentInput {
  mediaObjectId: number;
  content: string;
  timestamp?: number;
  cameraState?: unknown;
  /** 2D drawing + surface point attached to the feedback — guest schema, not a member's. */
  annotation?: unknown;
}

export async function createGuest(guest: GuestActor, projectId: number, body: CreateGuestCommentInput) {
  await assertProjectWritable(projectId); // 38.B: archived project = read-only
  // The camera pose and the drawing come from a PUBLIC surface, with no account behind them: they are the
  // only free-form fields an anonymous holder of the link can write to the database, and they are then
  // rebroadcast to every socket of the project. They therefore go through their schema — the annotation
  // through the GUEST schema, narrower than a member's.
  const cameraState = parseCameraState(body.cameraState);
  const annotation = parseGuestAnnotation(body.annotation);
  const comment = await prisma.comment.create({
    data: {
      mediaObjectId: body.mediaObjectId,
      guestName: guest.name,
      content: sanitizeHtml(body.content),
      timestamp: body.timestamp ?? null,
      cameraState: cameraState ?? undefined,
      annotation: annotation ?? undefined,
      // A client's feedback must necessarily be read on the client side: it stays visible to the link.
      isVisibleToClient: true,
    },
    include: commentInclude,
  });
  const enriched = await enrichComment(asRawComment(comment));
  emitToProject(projectId, 'comment:new', enriched);

  // Outgoing webhooks + v1 journal: `actorId` stays null (no account); the link and the declared name travel
  // in the payload — this is what makes it possible to find out who spoke.
  publishApiEvent('comment.created', {
    projectId,
    entityType: 'comment',
    entityId: comment.id,
    actorId: null,
    payload: {
      commentId: comment.id,
      mediaObjectId: body.mediaObjectId,
      projectId,
      authorId: null,
      guestName: guest.name,
      shareLinkId: guest.shareLinkId,
      parentId: null,
      timestamp: body.timestamp ?? null,
    },
  });

  // 48: the client's feedback also goes out as a ShotGrid note, like an internal feedback.
  await enqueuePush(projectId, { type: 'comment', commentId: comment.id, actorId: null });

  const notified = await notifyWatchers({
    mediaObjectId: body.mediaObjectId,
    projectId,
    messageKey: 'notification.clientComment',
    params: { name: guest.name },
  });
  if (guest.shareOwnerId && !notified.includes(guest.shareOwnerId)) {
    // Kind `watch`: the same as `notifyWatchers` — it is this that gives the `WATCH` type, the one that
    // points the notification to the media's review on the front end.
    // An unknown type would lead to the project page, and the reader would lose the shot being talked about.
    await notify({
      userId: guest.shareOwnerId,
      kind: 'watch',
      messageKey: 'notification.clientComment',
      params: { name: guest.name },
      projectId,
      referenceId: body.mediaObjectId,
    });
  }
  void sendDiscord('chat.newComment', { project: projectId });
  return enriched;
}

/**
 * Returns an edit's feedback to the shot's review (Phase 46).
 *
 * Nothing is copied: the comment is already anchored to the shot's media and to its position WITHIN that shot
 * (`timestamp`), computed when it was written. Sharing it therefore only lifts the curtain — it lands on the
 * exact frame, and stays on the edit. A copy would have diverged at the first correction.
 */
export async function share(user: SessionUser, projectId: number, id: number) {
  await assertProjectWritable(projectId);
  const existing = await prisma.comment.findUnique({
    where: { id },
    select: { userId: true, timelineId: true, mediaObjectId: true, sharedToShot: true },
  });
  if (!existing) return null; // reported as "not found" by the route
  if (existing.timelineId === null) throw badRequest("Ce commentaire n'appartient pas à un montage");
  if (!isManager(user.role) && existing.userId !== user.id)
    throw forbidden("Seul l'auteur ou un superviseur peut renvoyer un retour");

  const comment = await prisma.comment.update({
    where: { id },
    data: { sharedToShot: true },
    include: commentInclude,
  });
  const enriched = await enrichComment(asRawComment(comment));
  emitToProject(projectId, 'comment:new', enriched);
  // The feedback enters the shot's review: its followers now have reason to be alerted.
  if (!existing.sharedToShot)
    await notifyWatchers({
      mediaObjectId: existing.mediaObjectId,
      projectId,
      messageKey: 'notification.montageShared',
      exclude: [user.id],
    });
  return enriched;
}

export interface UpdateCommentInput {
  content?: string;
  /**
   * COMPLETE list of attachments after editing (D5): the `PATCH` ignored them, so one could neither add nor
   * remove an image while correcting a comment. Absent = unchanged; present = replaces, and whatever drops
   * out is erased from storage.
   */
  attachments?: AttachmentRef[];
  /**
   * COMPLETE list of annotation parts after editing — 3D stroke eraser (Phase 50, batch 8). Absent =
   * unchanged; present = replaces. Reserved to the author, like the content: an annotation is their remark,
   * and it is replayed for all viewers of the media.
   */
  annotation?: unknown;
  /** Thread state (D1). `isResolved` derives from it and stays written in parallel. */
  state?: CommentState;
  isResolved?: boolean;
  isVisibleToClient?: boolean;
  assigneeId?: number | null;
}

/**
 * The two forms of the same thing (D1): the screen sends a state, the v1 API and the open-note counters read
 * a boolean. Writing both prevents a thread resolved from the review from remaining counted as open in the
 * weekly report.
 */
export function resolutionOf(
  state: CommentState | undefined,
  isResolved: boolean | undefined,
): { state?: CommentState; isResolved?: boolean } {
  if (state !== undefined) return { state, isResolved: state === 'RESOLVED' };
  if (isResolved !== undefined) return { state: isResolved ? 'RESOLVED' : 'OPEN', isResolved };
  return {};
}

export async function update(user: SessionUser, projectId: number, id: number, body: UpdateCommentInput) {
  const existing = await prisma.comment.findUnique({
    where: { id },
    select: { userId: true, attachments: true },
  });
  if (!existing) return null; // reported as "not found" by the route
  const manager = isManager(user.role);
  const isAuthor = existing.userId === user.id;

  if (body.content !== undefined && !isAuthor) throw forbidden("Seul l'auteur peut éditer le contenu");
  if (body.attachments !== undefined && !isAuthor)
    throw forbidden("Seul l'auteur peut éditer les pièces jointes");
  if (body.annotation !== undefined && !isAuthor) throw forbidden('Only the author can edit the annotation');
  // Re-read by the schema here too, as at creation: the route is not the only caller.
  const annotation = body.annotation === undefined ? undefined : (parseAnnotation(body.annotation) ?? []);
  // Same guard as at creation — the key comes from the client and is used to sign a read — plus the ShotGrid
  // folder OF THIS COMMENT: an imported note stores its files there, and refusing them here would erase them
  // at the first text correction.
  const attachments =
    body.attachments === undefined
      ? undefined
      : filterAttachments(body.attachments, [ownAttachmentPrefix(user.id), shotgridAttachmentPrefix(id)]);
  // Same guard as at creation for the blobs of a cloud-edit proposal — against the list AFTER editing, which
  // now decides the life of the objects. Removing the attachment and keeping the part would describe a blob
  // the purge has just carried away.
  if (annotation !== undefined)
    await assertSplatEditBlobs(annotation, {
      attachedKeys: attachments ? attachments.map((a) => a.key) : attachmentKeys(existing.attachments),
      stat: (key) => storage.statObject(key),
    });
  if ((body.isVisibleToClient !== undefined || body.assigneeId !== undefined) && !manager)
    throw forbidden('Supervisors and administrators only');
  // Same guard as for a task (`EntityAssigneeService`): the identifier comes from the client, and nothing
  // required it to designate someone on THIS project. Without it, a manager entrusted a note to an account
  // foreign to the project — disabled, a service account, or a member of another project — which then
  // received the notification.
  if (body.assigneeId != null) await assertAssignable(projectId, [body.assigneeId]);
  const resolution = resolutionOf(body.state, body.isResolved);
  if (resolution.isResolved !== undefined && !manager && !isAuthor)
    throw forbidden('You cannot resolve this comment');

  const comment = await prisma.comment.update({
    where: { id },
    data: {
      ...(body.content !== undefined ? { content: sanitizeHtml(body.content), isEdited: true } : {}),
      ...(attachments !== undefined ? { attachments: jsonAttachments(attachments), isEdited: true } : {}),
      ...(annotation !== undefined ? { annotation: annotation, isEdited: true } : {}),
      // Resolution trace (32.A): who resolved it and when; cleared on reopening.
      ...(resolution.state !== undefined
        ? {
            state: resolution.state,
            isResolved: resolution.isResolved!,
            resolvedById: resolution.isResolved ? user.id : null,
            resolvedAt: resolution.isResolved ? new Date() : null,
          }
        : {}),
      ...(body.isVisibleToClient !== undefined ? { isVisibleToClient: body.isVisibleToClient } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
    },
    include: commentInclude,
  });
  const enriched = await enrichComment(asRawComment(comment));
  emitToProject(projectId, 'comment:update', enriched);
  // MinIO effects AFTER commit: the images removed by the edit leave storage.
  if (attachments !== undefined) await purgeAttachments(orphanedKeys(existing.attachments, attachments));

  // Notifies the new assignee (except self-assignment).
  if (body.assigneeId && body.assigneeId !== user.id) {
    await notify({
      userId: body.assigneeId,
      kind: 'commentAssigned',
      messageKey: 'notification.commentAssigned',
      projectId,
      referenceId: comment.mediaObjectId,
    });
  }
  return enriched;
}

/**
 * The list as it is written into the JSON column. The double pass through `unknown` is deliberate:
 * `AttachmentRef` has OPTIONAL fields, which `InputJsonValue` does not accept as a type (an `undefined` is
 * not JSON), whereas they are simply absent at runtime — which is already what creation does.
 */
const jsonAttachments = (refs: AttachmentRef[]): Prisma.InputJsonValue =>
  refs as unknown as Prisma.InputJsonValue;

/** MinIO objects left orphaned — a storage failure must not make the write fail. */
async function purgeAttachments(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await storage.deleteObjects(keys).catch(() => undefined);
}

/** Deletes a comment (author or supervisor/admin). `false` if not found. */
export async function remove(user: SessionUser, projectId: number, id: number): Promise<boolean> {
  const existing = await prisma.comment.findUnique({
    where: { id },
    select: { userId: true, attachments: true },
  });
  if (!existing) return false;
  if (!isManager(user.role) && existing.userId !== user.id)
    throw forbidden("Suppression réservée à l'auteur ou un superviseur");
  // MinIO purge of the attached reference images (the DB rows go in cascade).
  await ReviewReferenceService.purgeForComment(id);
  // The comment's ShotGrid match (`ShotgridLink`) leaves with it, within this transaction: an `AFTER DELETE`
  // trigger handles it on the PostgreSQL side. The link used to survive the comment, and the next sync worked
  // on a ghost. Nothing to add here — the table being polymorphic, the guarantee must live in the database so
  // that it also covers comments erased by cascade (media, version, shot). See
  // `services/shotgrid/shotgridLinks.ts` and the migration `20260908090000_shotgrid_liens_fiables`. The
  // attachments of the deleted thread (the comment AND its replies, which go in cascade) used to stay in
  // MinIO indefinitely: we collect their keys before erasure.
  const replies = await prisma.comment.findMany({ where: { parentId: id }, select: { attachments: true } });
  const keys = [existing.attachments, ...replies.map((r) => r.attachments)].flatMap((a) =>
    orphanedKeys(a, []),
  );
  await prisma.comment.delete({ where: { id } });
  emitToProject(projectId, 'comment:delete', { id });
  // MinIO effects after commit: the row has gone, the objects follow.
  await purgeAttachments(keys);
  return true;
}

export async function addReaction(user: SessionUser, projectId: number, id: number, emoji: string) {
  const reaction = await prisma.reaction.upsert({
    where: { commentId_userId_emoji: { commentId: id, userId: user.id, emoji } },
    update: {},
    create: { commentId: id, userId: user.id, emoji },
  });
  emitToProject(projectId, 'comment:reaction', { commentId: id, reaction });
  return reaction;
}

export async function removeReaction(userId: number, projectId: number, id: number, emoji: string) {
  await prisma.reaction
    .delete({ where: { commentId_userId_emoji: { commentId: id, userId, emoji } } })
    .catch(() => undefined);
  emitToProject(projectId, 'comment:reaction:remove', { commentId: id, emoji, userId });
}
