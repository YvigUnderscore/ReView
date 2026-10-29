// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import {
  loadShare,
  loadShareWithSession,
  consumeView,
  studioBranding,
  listShareMedia,
  listSharePlaylists,
  listShareComments,
  findShareMedia,
  createShareComment,
  createShareDecision,
  shareDecisionStatuses,
  type ShareCommentInput,
} from '../services/ClientShareService';
import { buildClientMediaSource } from '../services/ClientMediaSourceService';
import { guestCommentBody, guestDecisionBody } from './clientShareBodies';
import { guestCommentRateLimit } from './clientShareLimits';
import { signShareSession, verifyShareSession } from '../lib/shareAccess';
import { getWatermarkConfig } from '../lib/watermarkConfig';
import { logAudit } from '../services/AuditService';
import { logMediaAccess } from '../lib/mediaAccess';
import { badRequest, notFound, unauthorized } from '../lib/errors';

/**
 * PUBLIC routes (no JWT) for secure client sharing (35.C/35.D).
 * Sharing session: issued by GET /:token (free link) or POST /:token/unlock (password). Each issuance
 * consumes one view; the sub-routes require `X-Share-Auth`.
 * Any access to a media goes through `findShareMedia`, hence through the SCOPE of the link.
 */
const router = Router();

const tokenParam = z.object({ token: z.string().min(8).max(128) });
const tokenAndId = tokenParam.extend({ id: z.coerce.number().int() });

// GET /api/client/:token — project and media of the scope; issues the session (counts a view)
router.get('/:token', validate({ params: tokenParam }), async (req, res) => {
  const share = await loadShare(String(req.params.token));
  const studio = await studioBranding();
  const hasSession = verifyShareSession(req.header('x-share-auth') ?? undefined, share.id);

  if (share.passwordHash && !hasSession) {
    // Locked: only disclose the studio decoration, not the project.
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
    // `episodesEnabled`: without it the front end would guess the level from `episodes.length > 0`,
    // which is wrong as soon as a single episode lingers on a project where the level is disabled.
    select: { id: true, name: true, description: true, status: true, episodesEnabled: true },
  });
  if (!project) throw notFound('Project not found');

  const { media, browse, total, hasMore } = await listShareMedia(share, share.id);
  // Playlists are read AFTER the media: their identifiers are intersected with the served page,
  // so that a card never opens onto a tile absent from the payload.
  const [playlists, watermark, decisionStatuses] = await Promise.all([
    listSharePlaylists(share, new Set(media.map((m) => m.id))),
    getWatermarkConfig(),
    shareDecisionStatuses(share),
  ]);
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
    browse: { ...browse, playlists },
    // The two answers offered: absent as soon as the link is not allowed to decide, which spares the
    // front end from having to re-decide the permission.
    decisionStatuses,
    watermark: { enabled: watermark.shares, opacity: watermark.opacity },
    shareAuth: signShareSession(share.id),
  });
});

// POST /api/client/:token/unlock — verifies the password, issues the session (counts a view)
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

// GET /api/client/:token/media/:id/url — what is needed to open a media OF THE SCOPE (session
// required). `findShareMedia` has already decided the access; the payload is assembled by
// `ClientMediaSourceService`, which documents why each field is there.
router.get('/:token/media/:id/url', validate({ params: tokenAndId }), async (req, res) => {
  const share = await loadShareWithSession(String(req.params.token), req);
  const id = Number(req.params.id);
  const media = await findShareMedia(share, id);
  logMediaAccess({ mediaObjectId: id, shareLinkId: share.id, ip: req.ip }); // 36.E
  res.json(await buildClientMediaSource(media, share.projectId));
});

// GET /api/client/:token/media/:id/comments — client-visible comments (session required)
router.get('/:token/media/:id/comments', validate({ params: tokenAndId }), async (req, res) => {
  const share = await loadShareWithSession(String(req.params.token), req);
  const id = Number(req.params.id);
  await findShareMedia(share, id);
  res.json({ comments: await listShareComments(id) });
});

// POST /api/client/:token/media/:id/comments — guest comment (COMMENT permission).
// Goes through `CommentService.createGuest`: a client's feedback triggers the same chain as an internal
// feedback (followers, webhooks, v1 log, ShotGrid note), instead of the mere socket `emit` that was lost
// as soon as nobody had the project open.
router.post(
  '/:token/media/:id/comments',
  // Write open to an anonymous visitor: braked per link and per link+IP (cf. clientShareLimits).
  ...guestCommentRateLimit,
  validate({ params: tokenAndId, body: guestCommentBody }),
  async (req, res) => {
    const share = await loadShareWithSession(String(req.params.token), req);
    const id = Number(req.params.id);
    const comment = await createShareComment(share, id, req.body as ShareCommentInput, req.ip);
    res.status(201).json({ comment });
  },
);

// POST /api/client/:token/media/:id/decision — guest's opinion (DECIDE permission).
// It does not overwrite the status of the version: the studio decides (cf. `decideAsGuest`).
router.post(
  '/:token/media/:id/decision',
  // Same brake as for the comment: it is the same anonymous write surface.
  ...guestCommentRateLimit,
  validate({ params: tokenAndId, body: guestDecisionBody }),
  async (req, res) => {
    const share = await loadShareWithSession(String(req.params.token), req);
    const body = req.body as { guestName: string; statusId: number; comment?: string };
    const decision = await createShareDecision(share, Number(req.params.id), body);
    res.status(201).json({ decision });
  },
);

export default router;
