import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { sanitizeHtml } from '../lib/sanitize';
import { resolveProjectIdForMedia, resolveProjectIdForComment } from '../lib/pipeline';
import { emitToProject } from '../services/SocketService';
import { notify, sendDiscord } from '../services/NotificationService';
import { toPublicUser } from '../lib/userView';
import { storage } from '../services/StorageService';
import { badRequest, forbidden, notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

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

// GET /api/comments?mediaObjectId=X — fil de commentaires (racines + réponses) d'un média
router.get(
  '/',
  validate({ query: z.object({ mediaObjectId: z.coerce.number().int() }) }),
  async (req, res) => {
    const mediaObjectId = Number(req.query.mediaObjectId);
    const projectId = await resolveProjectIdForMedia(mediaObjectId);
    if (!projectId) throw notFound('Média introuvable');
    await assertProjectAccess(req, projectId);

    const comments = await prisma.comment.findMany({
      where: { mediaObjectId, parentId: null },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
      include: {
        ...commentInclude,
        replies: { orderBy: { createdAt: 'asc' }, include: commentInclude },
      },
    });
    res.json({ comments: await Promise.all(comments.map((c) => enrichComment(asRawComment(c)))) });
  },
);

// POST /api/comments/attachments/presign — URL présignée pour une image jointe au fil
router.post(
  '/attachments/presign',
  validate({
    body: z.object({
      filename: z.string().min(1).max(200),
      contentType: z.string().regex(/^image\/(png|jpe?g|webp|gif)$/),
    }),
  }),
  async (req, res) => {
    const { filename, contentType } = req.body as { filename: string; contentType: string };
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `comments/attachments/${req.user!.id}/${Date.now()}-${safe}`;
    const url = await storage.getPresignedPutUrl(key, contentType, 900);
    res.json({ url, key });
  },
);

// POST /api/comments — commentaire de review (vidéo: timestamp ; 3D: cameraState ; image: annotation)
router.post(
  '/',
  validate({
    body: z.object({
      mediaObjectId: z.number().int(),
      content: z.string().min(1).max(10000),
      timestamp: z.number().nonnegative().optional(),
      duration: z.number().nonnegative().optional(),
      annotation: z.any().optional(),
      cameraState: z.any().optional(),
      attachments: z
        .array(
          z.object({
            key: z.string().max(512),
            name: z.string().max(200).optional(),
            contentType: z.string().max(100).optional(),
          }),
        )
        .max(8)
        .optional(),
      parentId: z.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const body = req.body as {
      mediaObjectId: number;
      content: string;
      timestamp?: number;
      duration?: number;
      annotation?: unknown;
      cameraState?: unknown;
      attachments?: { key: string; name?: string; contentType?: string }[];
      parentId?: number;
    };
    const projectId = await resolveProjectIdForMedia(body.mediaObjectId);
    if (!projectId) throw notFound('Média introuvable');
    await assertProjectAccess(req, projectId);

    // Sécurité : seules les clés du dossier de pièces jointes sont acceptées
    const attachments = (body.attachments ?? []).filter((a) => a.key.startsWith('comments/attachments/'));

    // Une réponse doit cibler un commentaire du même média
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
        userId: req.user!.id,
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
      if (parent?.userId && parent.userId !== req.user!.id) {
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
    res.status(201).json({ comment: enriched });
  },
);

// PATCH /api/comments/:id — édition contenu (auteur), résolution (auteur/superviseur),
// visibilité client + assignation (superviseur/admin).
router.patch(
  '/:id',
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      content: z.string().min(1).max(10000).optional(),
      isResolved: z.boolean().optional(),
      isVisibleToClient: z.boolean().optional(),
      assigneeId: z.number().int().nullable().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const existing = await prisma.comment.findUnique({ where: { id }, select: { userId: true } });
    if (!existing) throw notFound('Commentaire introuvable');
    const projectId = await resolveProjectIdForComment(id);
    if (!projectId) throw notFound('Commentaire orphelin');
    await assertProjectAccess(req, projectId);

    const body = req.body as {
      content?: string;
      isResolved?: boolean;
      isVisibleToClient?: boolean;
      assigneeId?: number | null;
    };
    const manager = isManager(req.user!.role);
    const isAuthor = existing.userId === req.user!.id;

    if (body.content !== undefined && !isAuthor) throw forbidden("Seul l'auteur peut éditer le contenu");
    if ((body.isVisibleToClient !== undefined || body.assigneeId !== undefined) && !manager) {
      throw forbidden('Réservé aux superviseurs/admins');
    }
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

    // Notifie le nouvel assigné (hors auto-assignation)
    if (body.assigneeId && body.assigneeId !== req.user!.id) {
      // referenceId = média du commentaire → navigable vers la review côté front (10.C5).
      await notify({
        userId: body.assigneeId,
        type: 'COMMENT_ASSIGNED',
        content: 'Un commentaire vous a été assigné',
        projectId,
        referenceId: comment.mediaObjectId,
      });
    }
    res.json({ comment: enriched });
  },
);

// DELETE /api/comments/:id — auteur ou superviseur/admin
router.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.comment.findUnique({ where: { id }, select: { userId: true } });
  if (!existing) throw notFound('Commentaire introuvable');
  const projectId = await resolveProjectIdForComment(id);
  if (!projectId) throw notFound('Commentaire orphelin');
  await assertProjectAccess(req, projectId);
  if (!isManager(req.user!.role) && existing.userId !== req.user!.id) {
    throw forbidden("Suppression réservée à l'auteur ou un superviseur");
  }
  await prisma.comment.delete({ where: { id } });
  emitToProject(projectId, 'comment:delete', { id });
  res.status(204).end();
});

// POST /api/comments/:id/reactions — ajoute/maj une réaction emoji
router.post(
  '/:id/reactions',
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({ emoji: z.string().min(1).max(16) }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const projectId = await resolveProjectIdForComment(id);
    if (!projectId) throw notFound('Commentaire introuvable');
    await assertProjectAccess(req, projectId);
    const { emoji } = req.body as { emoji: string };
    const reaction = await prisma.reaction.upsert({
      where: { commentId_userId_emoji: { commentId: id, userId: req.user!.id, emoji } },
      update: {},
      create: { commentId: id, userId: req.user!.id, emoji },
    });
    emitToProject(projectId, 'comment:reaction', { commentId: id, reaction });
    res.status(201).json({ reaction });
  },
);

// DELETE /api/comments/:id/reactions/:emoji — retire une réaction
router.delete(
  '/:id/reactions/:emoji',
  validate({ params: z.object({ id: z.coerce.number().int(), emoji: z.string().min(1).max(16) }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const emoji = String(req.params.emoji);
    const projectId = await resolveProjectIdForComment(id);
    if (!projectId) throw notFound('Commentaire introuvable');
    await assertProjectAccess(req, projectId);
    await prisma.reaction
      .delete({ where: { commentId_userId_emoji: { commentId: id, userId: req.user!.id, emoji } } })
      .catch(() => undefined);
    emitToProject(projectId, 'comment:reaction:remove', { commentId: id, emoji, userId: req.user!.id });
    res.status(204).end();
  },
);

export default router;
