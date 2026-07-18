import { Router } from 'express';
import { z } from 'zod';
import { SharePermission } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';
import { storage } from '../services/StorageService';
import { mediaSourceKey } from '../services/MediaService';
import { sanitizeHtml } from '../lib/sanitize';
import { emitToProject } from '../services/SocketService';
import { forbidden, notFound } from '../lib/errors';

/**
 * Routes PUBLIQUES (sans JWT) pour le partage client sécurisé.
 * L'accès est porté par un token de ShareLink (révocable, à durée de vie configurable).
 */
const router = Router();

async function getValidShare(token: string) {
  const share = await prisma.shareLink.findUnique({ where: { token } });
  if (!share || share.revoked) return null;
  if (share.expiresAt && share.expiresAt < new Date()) return null;
  return share;
}

// Médias publiés (version PUBLISHED, statut READY) d'un projet
const publishedMediaWhere = (projectId: number) => ({
  status: 'READY' as const,
  published: true,
  version: {
    published: true,
    OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
  },
});

// GET /api/client/:token — projet + médias publiés (lecture seule)
router.get(
  '/:token',
  validate({ params: z.object({ token: z.string().min(8).max(128) }) }),
  async (req, res) => {
    const share = await getValidShare(String(req.params.token));
    if (!share) throw notFound('Lien invalide ou expiré');
    const project = await prisma.project.findFirst({
      where: { id: share.projectId, deletedAt: null },
      select: { id: true, name: true, description: true, status: true },
    });
    if (!project) throw notFound('Projet introuvable');

    const media = await prisma.mediaObject.findMany({
      where: publishedMediaWhere(share.projectId),
      orderBy: { createdAt: 'desc' },
    });
    const withUrls = await Promise.all(
      media.map(async (m) => ({
        id: m.id,
        kind: m.kind,
        originalName: m.originalName,
        thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
      })),
    );

    res.json({ project, permission: share.permission, media: withUrls });
  },
);

// GET /api/client/:token/media/:id/url — URL présignée d'un média publié
router.get(
  '/:token/media/:id/url',
  validate({ params: z.object({ token: z.string().min(8).max(128), id: z.coerce.number().int() }) }),
  async (req, res) => {
    const share = await getValidShare(String(req.params.token));
    if (!share) throw notFound('Lien invalide ou expiré');
    const id = Number(req.params.id);
    const media = await prisma.mediaObject.findFirst({
      where: { id, ...publishedMediaWhere(share.projectId) },
    });
    if (!media) throw notFound('Média introuvable ou non publié');
    res.json({ url: await storage.getPresignedGetUrl(mediaSourceKey(media)) });
  },
);

// GET /api/client/:token/media/:id/comments — commentaires visibles client
router.get(
  '/:token/media/:id/comments',
  validate({ params: z.object({ token: z.string().min(8).max(128), id: z.coerce.number().int() }) }),
  async (req, res) => {
    const share = await getValidShare(String(req.params.token));
    if (!share) throw notFound('Lien invalide ou expiré');
    const id = Number(req.params.id);
    const media = await prisma.mediaObject.findFirst({
      where: { id, ...publishedMediaWhere(share.projectId) },
    });
    if (!media) throw notFound('Média introuvable ou non publié');
    const comments = await prisma.comment.findMany({
      where: { mediaObjectId: id, parentId: null, isVisibleToClient: true },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
      include: { author: { select: { id: true, name: true } } },
    });
    res.json({ comments });
  },
);

// POST /api/client/:token/media/:id/comments — commentaire invité (si permission COMMENT)
router.post(
  '/:token/media/:id/comments',
  validate({
    params: z.object({ token: z.string().min(8).max(128), id: z.coerce.number().int() }),
    body: z.object({
      guestName: z.string().min(1).max(80),
      content: z.string().min(1).max(10000),
      timestamp: z.number().nonnegative().optional(),
      cameraState: z.any().optional(),
    }),
  }),
  async (req, res) => {
    const share = await getValidShare(String(req.params.token));
    if (!share) throw notFound('Lien invalide ou expiré');
    if (share.permission !== SharePermission.COMMENT) throw forbidden('Ce lien est en lecture seule');
    const id = Number(req.params.id);
    const media = await prisma.mediaObject.findFirst({
      where: { id, ...publishedMediaWhere(share.projectId) },
    });
    if (!media) throw notFound('Média introuvable ou non publié');

    const body = req.body as {
      guestName: string;
      content: string;
      timestamp?: number;
      cameraState?: unknown;
    };
    const comment = await prisma.comment.create({
      data: {
        mediaObjectId: id,
        guestName: body.guestName,
        content: sanitizeHtml(body.content),
        timestamp: body.timestamp ?? null,
        cameraState: (body.cameraState ?? undefined) as object | undefined,
        isVisibleToClient: true,
      },
      include: { author: { select: { id: true, name: true } } },
    });
    emitToProject(share.projectId, 'comment:new', comment);
    res.status(201).json({ comment });
  },
);

export default router;
