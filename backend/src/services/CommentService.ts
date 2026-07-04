import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sanitizeHtml } from '../lib/sanitize';
import { emitToProject } from './SocketService';
import { notify, sendDiscord } from './NotificationService';
import { toPublicUser } from '../lib/userView';
import { storage } from './StorageService';
import { badRequest, forbidden } from '../lib/errors';

/**
 * Logique métier des commentaires de review (fil, enrichissement auteur/pièces jointes,
 * réactions, notifications). L'accès projet (RBAC) est asserté dans la route ; ces
 * fonctions reçoivent le projectId déjà résolu et vérifié (10.D8).
 */

type SessionUser = { id: number; role: Role };

const isManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

const commentInclude = {
  author: {
    select: {
      id: true,
      name: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
      avatarKey: true,
    },
  },
  reactions: { select: { id: true, emoji: true, userId: true } },
} as const;

// Remplace l'auteur brut par une vue publique (displayName, initials, avatarUrl présigné).
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
  replies?: RawComment[];
  attachments?: unknown;
  [k: string]: unknown;
}

// Résout les pièces jointes (clés MinIO) en URLs présignées affichables.
async function resolveAttachments(attachments: unknown): Promise<unknown> {
  if (!Array.isArray(attachments)) return attachments ?? undefined;
  return Promise.all(
    (attachments as RawAttachment[]).map(async (a) => ({
      ...a,
      url: a.key ? await storage.getPresignedGetUrl(a.key).catch(() => null) : null,
    })),
  );
}

async function enrichComment(c: RawComment): Promise<Record<string, unknown>> {
  return {
    ...c,
    author: await toPublicUser(c.author),
    attachments: await resolveAttachments(c.attachments),
    replies: c.replies ? await Promise.all(c.replies.map(enrichComment)) : undefined,
  };
}
const asRawComment = (c: unknown) => c as RawComment;

/** Fil de commentaires (racines + réponses) d'un média, enrichi. */
export async function listThread(mediaObjectId: number) {
  const comments = await prisma.comment.findMany({
    where: { mediaObjectId, parentId: null },
    orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
    include: { ...commentInclude, replies: { orderBy: { createdAt: 'asc' }, include: commentInclude } },
  });
  return Promise.all(comments.map((c) => enrichComment(asRawComment(c))));
}

/** URL présignée PUT pour une image jointe au fil. */
export async function presignAttachment(userId: number, filename: string, contentType: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `comments/attachments/${userId}/${Date.now()}-${safe}`;
  const url = await storage.getPresignedPutUrl(key, contentType, 900);
  return { url, key };
}

export interface CreateCommentInput {
  mediaObjectId: number;
  content: string;
  timestamp?: number;
  duration?: number;
  annotation?: unknown;
  cameraState?: unknown;
  attachments?: { key: string; name?: string; contentType?: string }[];
  parentId?: number;
}

export async function create(user: SessionUser, projectId: number, body: CreateCommentInput) {
  // Sécurité : seules les clés du dossier de pièces jointes sont acceptées.
  const attachments = (body.attachments ?? []).filter((a) => a.key.startsWith('comments/attachments/'));

  // Une réponse doit cibler un commentaire du même média.
  if (body.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: body.parentId },
      select: { mediaObjectId: true },
    });
    if (!parent || parent.mediaObjectId !== body.mediaObjectId)
      throw badRequest('Commentaire parent invalide');
  }

  const comment = await prisma.comment.create({
    data: {
      mediaObjectId: body.mediaObjectId,
      userId: user.id,
      content: sanitizeHtml(body.content),
      timestamp: body.timestamp ?? null,
      duration: body.duration ?? null,
      annotation: (body.annotation ?? undefined) as object | undefined,
      cameraState: (body.cameraState ?? undefined) as object | undefined,
      attachments: attachments.length > 0 ? (attachments as object) : undefined,
      parentId: body.parentId ?? null,
    },
    include: commentInclude,
  });
  const enriched = await enrichComment(asRawComment(comment));
  emitToProject(projectId, 'comment:new', enriched);

  // Notifications : réponse → auteur du commentaire parent ; sinon ping Discord projet.
  if (body.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: body.parentId },
      select: { userId: true },
    });
    if (parent?.userId && parent.userId !== user.id) {
      // referenceId = média (et non le commentaire) → navigable vers la review côté front (10.C5).
      await notify({
        userId: parent.userId,
        type: 'REPLY',
        content: 'Nouvelle réponse à votre commentaire',
        projectId,
        referenceId: body.mediaObjectId,
      });
    }
  } else {
    void sendDiscord(`💬 Nouveau commentaire sur un média (projet #${projectId})`);
  }
  return enriched;
}

export interface UpdateCommentInput {
  content?: string;
  isResolved?: boolean;
  isVisibleToClient?: boolean;
  assigneeId?: number | null;
}

export async function update(user: SessionUser, projectId: number, id: number, body: UpdateCommentInput) {
  const existing = await prisma.comment.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) return null; // signalé « introuvable » par la route
  const manager = isManager(user.role);
  const isAuthor = existing.userId === user.id;

  if (body.content !== undefined && !isAuthor) throw forbidden("Seul l'auteur peut éditer le contenu");
  if ((body.isVisibleToClient !== undefined || body.assigneeId !== undefined) && !manager)
    throw forbidden('Réservé aux superviseurs/admins');
  if (body.isResolved !== undefined && !manager && !isAuthor) throw forbidden('Résolution non autorisée');

  const comment = await prisma.comment.update({
    where: { id },
    data: {
      ...(body.content !== undefined ? { content: sanitizeHtml(body.content), isEdited: true } : {}),
      ...(body.isResolved !== undefined ? { isResolved: body.isResolved } : {}),
      ...(body.isVisibleToClient !== undefined ? { isVisibleToClient: body.isVisibleToClient } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
    },
    include: commentInclude,
  });
  const enriched = await enrichComment(asRawComment(comment));
  emitToProject(projectId, 'comment:update', enriched);

  // Notifie le nouvel assigné (hors auto-assignation).
  if (body.assigneeId && body.assigneeId !== user.id) {
    await notify({
      userId: body.assigneeId,
      type: 'COMMENT_ASSIGNED',
      content: 'Un commentaire vous a été assigné',
      projectId,
      referenceId: comment.mediaObjectId,
    });
  }
  return enriched;
}

/** Supprime un commentaire (auteur ou superviseur/admin). `false` si introuvable. */
export async function remove(user: SessionUser, projectId: number, id: number): Promise<boolean> {
  const existing = await prisma.comment.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) return false;
  if (!isManager(user.role) && existing.userId !== user.id)
    throw forbidden("Suppression réservée à l'auteur ou un superviseur");
  await prisma.comment.delete({ where: { id } });
  emitToProject(projectId, 'comment:delete', { id });
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
