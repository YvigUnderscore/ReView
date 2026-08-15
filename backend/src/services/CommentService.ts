// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
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
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/**
 * Logique métier des commentaires de review (fil, enrichissement auteur/pièces jointes,
 * réactions, notifications). L'accès projet (RBAC) est asserté dans la route ; ces
 * fonctions reçoivent le projectId déjà résolu et vérifié (10.D8).
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
  resolvedBy?: RawAuthor | null;
  replies?: RawComment[];
  attachments?: unknown;
  [k: string]: unknown;
}

// Résout les pièces jointes (clés MinIO) en URLs présignées affichables.
// Le `Content-Type` de la réponse est imposé : le type stocké vient du navigateur au moment
// du PUT présigné (que la signature ne contraint pas), un fichier déposé en `text/html`
// s'exécuterait donc sur l'origine de l'application au moment où quelqu'un ouvre le lien.
// On repart du type enregistré à la création du commentaire, lui-même filtré par la route.
async function resolveAttachments(attachments: unknown): Promise<unknown> {
  if (!Array.isArray(attachments)) return attachments ?? undefined;
  return Promise.all(
    (attachments as RawAttachment[]).map(async (a) => ({
      ...a,
      url: a.key ? await storage.getPresignedGetUrl(a.key, 3600, a.contentType).catch(() => null) : null,
    })),
  );
}

async function enrichComment(c: RawComment): Promise<Record<string, unknown>> {
  return {
    ...c,
    // L'auteur peut être `null` : la relation est en SetNull, un compte supprimé laisse
    // ses commentaires derrière lui. Le déréférencer cassait tout le fil en 500.
    author: await toPublicUserOrDeleted(c.author),
    resolvedBy: c.resolvedBy ? await toPublicUser(c.resolvedBy) : null,
    attachments: await resolveAttachments(c.attachments),
    replies: c.replies ? await Promise.all(c.replies.map(enrichComment)) : undefined,
  };
}
const asRawComment = (c: unknown) => c as RawComment;

/**
 * Fil de commentaires (racines paginées + réponses imbriquées) d'un média, enrichi.
 *
 * Les retours écrits depuis un montage restent chez lui : ils n'apparaissent ici qu'une
 * fois renvoyés explicitement (Phase 46). Un montage se relit plan par plan et produit
 * beaucoup de notes de coupe ; les déverser d'office dans la review de l'artiste noierait
 * les retours qui lui sont adressés.
 */
export async function listThread(mediaObjectId: number, p: PaginationParams): Promise<Paginated<unknown>> {
  const where = {
    mediaObjectId,
    parentId: null,
    OR: [{ timelineId: null }, { sharedToShot: true }],
  };
  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
      ...pageArgs(p),
      include: { ...commentInclude, replies: { orderBy: { createdAt: 'asc' }, include: commentInclude } },
    }),
    prisma.comment.count({ where }),
  ]);
  const items = await Promise.all(comments.map((c) => enrichComment(asRawComment(c))));
  return paginate(items, total, p);
}

/**
 * Fil d'un montage (Phase 46) : les retours posés sur le film, dans son ordre à lui.
 *
 * L'ordre est celui de `timelineTime` — la position dans le montage entier — et non celui
 * du timecode de chaque plan : sur une seule timeline, deux retours de plans différents
 * n'ont de sens l'un par rapport à l'autre que sur cette échelle.
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

/** URL présignée PUT pour une image jointe au fil. */
export async function presignAttachment(userId: number, filename: string, contentType: string) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `comments/attachments/${userId}/${Date.now()}-${safe}`;
  const url = await storage.getPresignedPutUrl(key, contentType, 900);
  return { url, key };
}

/** Jetons `@xxx` d'un texte (mentions 32.B) — dédoublonnés, en minuscules. */
export function extractMentionTokens(content: string): string[] {
  const tokens = [...content.matchAll(/(^|[\s([{.,;:!?'"«»])@([a-zA-Z0-9._-]+)/g)].map((m) =>
    m[2]!.toLowerCase(),
  );
  return [...new Set(tokens)];
}

/**
 * Notifie les membres du projet mentionnés par `@username` (ou `@partie-locale` de
 * l'email pour les comptes sans pseudo). L'auteur du commentaire est exclu.
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
        type: 'MENTION',
        content: 'Vous avez été mentionné dans un commentaire',
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
  attachments?: { key: string; name?: string; contentType?: string }[];
  parentId?: number;
  /** Retour écrit depuis un montage : il lui appartient (Phase 46). */
  timelineId?: number;
  /** Position dans le montage entier (s) — `timestamp` reste la position dans le plan. */
  timelineTime?: number;
}

export async function create(user: SessionUser, projectId: number, body: CreateCommentInput) {
  await assertProjectWritable(projectId); // 38.B : projet archivé = lecture seule
  // Sécurité : la clé de pièce jointe est fournie par le client, elle sert ensuite à
  // signer une URL de lecture. On n'accepte donc que le dossier que CET utilisateur a pu
  // remplir via `presignAttachment` — le dossier global laisserait joindre (et donc lire)
  // la pièce jointe d'un autre utilisateur, sur un autre projet.
  const ownPrefix = `comments/attachments/${user.id}/`;
  const attachments = (body.attachments ?? []).filter(
    (a) => a.key.startsWith(ownPrefix) && !a.key.includes('..'),
  );

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
      timelineId: body.timelineId ?? null,
      timelineTime: body.timelineTime ?? null,
    },
    include: commentInclude,
  });
  const enriched = await enrichComment(asRawComment(comment));
  emitToProject(projectId, 'comment:new', enriched);
  // Webhooks sortants (36.D) + journal d'événements de l'API v1.
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

  // 48 : le retour part aussi vers ShotGrid, en note rattachée à la version, avec la
  // frame annotée en pièce jointe. Une réponse dans un fil reste locale — ShotGrid
  // n'a pas de notion de fil qui corresponde au nôtre.
  if (!body.parentId)
    await enqueuePush(projectId, { type: 'comment', commentId: comment.id, actorId: user.id });

  // Mentions @user (32.B) : notification ciblée des membres cités.
  const mentioned = await notifyMentions(user.id, projectId, body.mediaObjectId, comment.content);

  // Notifications : réponse → auteur du commentaire parent (sauf déjà notifié par
  // mention) ; sinon ping Discord projet.
  if (body.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: body.parentId },
      select: { userId: true },
    });
    if (parent?.userId && parent.userId !== user.id && !mentioned.includes(parent.userId)) {
      // referenceId = média (et non le commentaire) → navigable vers la review côté front (10.C5).
      await notify({
        userId: parent.userId,
        type: 'REPLY',
        content: 'Nouvelle réponse à votre commentaire',
        projectId,
        referenceId: body.mediaObjectId,
      });
    }
  } else if (body.timelineId) {
    // Retour de montage : les suiveurs du plan ne sont pas prévenus, puisque le retour
    // n'apparaît pas encore dans leur review. C'est `share` qui les avertit.
    void sendDiscord(`🎬 Nouveau retour sur un montage (projet #${projectId})`);
  } else {
    // Suiveurs (32.G) : nouveau commentaire racine sur la chaîne version/shot/asset.
    await notifyWatchers({
      mediaObjectId: body.mediaObjectId,
      projectId,
      content: 'Nouveau commentaire sur un élément suivi',
      exclude: [user.id, ...mentioned],
    });
    void sendDiscord(`💬 Nouveau commentaire sur un média (projet #${projectId})`);
  }
  return enriched;
}

/**
 * Renvoie un retour de montage sur la review du plan (Phase 46).
 *
 * Rien n'est recopié : le commentaire est déjà ancré au média du plan et à sa position
 * DANS ce plan (`timestamp`), calculée au moment où il a été écrit. Le partager ne fait
 * donc que lever le rideau — il tombe sur la frame exacte, et reste sur le montage.
 * Une copie, elle, aurait divergé dès la première correction.
 */
export async function share(user: SessionUser, projectId: number, id: number) {
  await assertProjectWritable(projectId);
  const existing = await prisma.comment.findUnique({
    where: { id },
    select: { userId: true, timelineId: true, mediaObjectId: true, sharedToShot: true },
  });
  if (!existing) return null; // signalé « introuvable » par la route
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
  // Le retour entre dans la review du plan : ses suiveurs ont maintenant lieu d'être avertis.
  if (!existing.sharedToShot)
    await notifyWatchers({
      mediaObjectId: existing.mediaObjectId,
      projectId,
      content: 'Un retour de montage a été renvoyé sur un élément suivi',
      exclude: [user.id],
    });
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
      // Trace de résolution (32.A) : qui a résolu et quand ; effacée à la réouverture.
      ...(body.isResolved !== undefined
        ? {
            isResolved: body.isResolved,
            resolvedById: body.isResolved ? user.id : null,
            resolvedAt: body.isResolved ? new Date() : null,
          }
        : {}),
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
  // Purge MinIO des images de référence jointes (les lignes DB partent en cascade).
  await ReviewReferenceService.purgeForComment(id);
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
