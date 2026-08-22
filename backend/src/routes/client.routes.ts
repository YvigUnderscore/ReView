// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { SharePermission } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { storage } from '../services/StorageService';
import { mediaSourceKey } from '../services/MediaService';
import {
  loadShare,
  loadShareWithSession,
  consumeView,
  studioBranding,
  listShareMedia,
  findShareMedia,
} from '../services/ClientShareService';
import { createGuest } from '../services/CommentService';
import { signShareSession, verifyShareSession } from '../lib/shareAccess';
import { getWatermarkConfig } from '../lib/watermarkConfig';
import { logAudit } from '../services/AuditService';
import { logMediaAccess } from '../lib/mediaAccess';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors';

/**
 * Routes PUBLIQUES (sans JWT) pour le partage client sécurisé (35.C/35.D).
 * Session de partage : émise par GET /:token (lien libre) ou POST /:token/unlock (mot de
 * passe) — chaque émission consomme une vue ; les sous-routes exigent `X-Share-Auth`.
 * Tout accès à un média passe par `findShareMedia`, donc par la PORTÉE du lien.
 */
const router = Router();

const tokenParam = z.object({ token: z.string().min(8).max(128) });
const tokenAndId = tokenParam.extend({ id: z.coerce.number().int() });

// GET /api/client/:token — projet + médias de la portée ; émet la session (compte une vue)
router.get('/:token', validate({ params: tokenParam }), async (req, res) => {
  const share = await loadShare(String(req.params.token));
  const studio = await studioBranding();
  const hasSession = verifyShareSession(req.header('x-share-auth') ?? undefined, share.id);

  if (share.passwordHash && !hasSession) {
    // Verrouillé : ne divulguer que l'habillage studio, pas le projet.
    res.json({ locked: true, studio });
    return;
  }
  if (!hasSession) {
    await consumeView(share);
    logAudit({
      action: 'SHARE_VIEW',
      entityType: 'Project',
      entityId: share.projectId,
      metadata: { shareLinkId: share.id, label: share.label, ip: req.ip ?? null },
    });
  }

  const project = await prisma.project.findFirst({
    where: { id: share.projectId, deletedAt: null },
    select: { id: true, name: true, description: true, status: true },
  });
  if (!project) throw notFound('Project not found');

  const { media, total, hasMore } = await listShareMedia(share);
  const watermark = await getWatermarkConfig();
  res.json({
    locked: false,
    studio,
    project,
    permission: share.permission,
    label: share.label,
    scope: share.scope,
    media,
    mediaTotal: total,
    mediaHasMore: hasMore,
    watermark: { enabled: watermark.shares, opacity: watermark.opacity },
    shareAuth: signShareSession(share.id),
  });
});

// POST /api/client/:token/unlock — vérifie le mot de passe, émet la session (compte une vue)
router.post(
  '/:token/unlock',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many attempts, try again later.' },
    keyGenerator: (req) => `unlock:${req.ip ?? 'unknown'}:${String(req.params.token ?? '')}`,
  }),
  validate({ params: tokenParam, body: z.object({ password: z.string().min(1).max(200) }) }),
  async (req, res) => {
    const share = await loadShare(String(req.params.token));
    if (!share.passwordHash) throw badRequest('This link has no password');
    const ok = await bcrypt.compare((req.body as { password: string }).password, share.passwordHash);
    if (!ok) {
      logAudit({
        action: 'SHARE_UNLOCK_FAIL',
        entityType: 'Project',
        entityId: share.projectId,
        metadata: { shareLinkId: share.id, ip: req.ip ?? null },
      });
      throw unauthorized('Wrong password');
    }
    await consumeView(share);
    logAudit({
      action: 'SHARE_VIEW',
      entityType: 'Project',
      entityId: share.projectId,
      metadata: { shareLinkId: share.id, label: share.label, ip: req.ip ?? null, unlocked: true },
    });
    res.json({ shareAuth: signShareSession(share.id) });
  },
);

// GET /api/client/:token/media/:id/url — URL présignée d'un média DE LA PORTÉE (session requise).
// Vidéo : sert le dérivé client (slate en tête, 35.A) s'il existe — `slateSec` permet au
// front de décaler les timestamps de commentaires (le slate n'existe pas côté review interne).
router.get('/:token/media/:id/url', validate({ params: tokenAndId }), async (req, res) => {
  const share = await loadShareWithSession(String(req.params.token), req);
  const id = Number(req.params.id);
  const media = await findShareMedia(share, id);
  logMediaAccess({ mediaObjectId: id, shareLinkId: share.id, ip: req.ip }); // 36.E
  const meta = (media.metadata ?? {}) as { clientProxyKey?: string; slateSec?: number };
  const clientKey = typeof meta.clientProxyKey === 'string' ? meta.clientProxyKey : null;
  res.json({
    url: await storage.getPresignedGetUrl(clientKey ?? mediaSourceKey(media)),
    slateSec: clientKey && typeof meta.slateSec === 'number' ? meta.slateSec : 0,
  });
});

// GET /api/client/:token/media/:id/comments — commentaires visibles client (session requise)
router.get('/:token/media/:id/comments', validate({ params: tokenAndId }), async (req, res) => {
  const share = await loadShareWithSession(String(req.params.token), req);
  const id = Number(req.params.id);
  await findShareMedia(share, id);
  const comments = await prisma.comment.findMany({
    where: { mediaObjectId: id, parentId: null, isVisibleToClient: true },
    orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }],
    include: { author: { select: { id: true, name: true } } },
  });
  res.json({ comments });
});

// POST /api/client/:token/media/:id/comments — commentaire invité (permission COMMENT).
// Passe par `CommentService.createGuest` : le retour d'un client déclenche la même chaîne
// qu'un retour interne (suiveurs, webhooks, journal v1, note ShotGrid), au lieu du seul
// `emit` socket qui se perdait dès que personne n'avait le projet ouvert.
router.post(
  '/:token/media/:id/comments',
  validate({
    params: tokenAndId,
    body: z.object({
      guestName: z.string().trim().min(1).max(80),
      content: z.string().min(1).max(10000),
      timestamp: z.number().nonnegative().optional(),
      cameraState: z.any().optional(),
    }),
  }),
  async (req, res) => {
    const share = await loadShareWithSession(String(req.params.token), req);
    if (share.permission !== SharePermission.COMMENT) throw forbidden('This link is read-only');
    const id = Number(req.params.id);
    await findShareMedia(share, id);

    const body = req.body as {
      guestName: string;
      content: string;
      timestamp?: number;
      cameraState?: unknown;
    };
    const comment = await createGuest(
      { name: body.guestName, shareLinkId: share.id, shareOwnerId: share.createdById },
      share.projectId,
      { mediaObjectId: id, content: body.content, timestamp: body.timestamp, cameraState: body.cameraState },
    );
    res.status(201).json({ comment });
  },
);

export default router;
