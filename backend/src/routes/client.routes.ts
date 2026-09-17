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
    // `episodesEnabled` : sans lui le front devinerait le niveau à `episodes.length > 0`,
    // faux dès qu'un seul épisode traîne sur un projet où le niveau est désactivé.
    select: { id: true, name: true, description: true, status: true, episodesEnabled: true },
  });
  if (!project) throw notFound('Project not found');

  const { media, browse, total, hasMore } = await listShareMedia(share, share.id);
  // Les playlists se lisent APRÈS les médias : leurs identifiants sont intersectés avec la
  // page servie, pour qu'une carte n'ouvre jamais sur une tuile absente du payload.
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
    // Les deux réponses offertes — absentes dès que le lien n'a pas le droit de se
    // prononcer, ce qui évite au front d'avoir à redécider de la permission.
    decisionStatuses,
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

// GET /api/client/:token/media/:id/url — de quoi ouvrir un média DE LA PORTÉE (session
// requise). `findShareMedia` a déjà tranché l'accès ; la charge utile est assemblée par
// `ClientMediaSourceService`, qui documente pourquoi chaque champ y est.
router.get('/:token/media/:id/url', validate({ params: tokenAndId }), async (req, res) => {
  const share = await loadShareWithSession(String(req.params.token), req);
  const id = Number(req.params.id);
  const media = await findShareMedia(share, id);
  logMediaAccess({ mediaObjectId: id, shareLinkId: share.id, ip: req.ip }); // 36.E
  res.json(await buildClientMediaSource(media, share.projectId));
});

// GET /api/client/:token/media/:id/comments — commentaires visibles client (session requise)
router.get('/:token/media/:id/comments', validate({ params: tokenAndId }), async (req, res) => {
  const share = await loadShareWithSession(String(req.params.token), req);
  const id = Number(req.params.id);
  await findShareMedia(share, id);
  res.json({ comments: await listShareComments(id) });
});

// POST /api/client/:token/media/:id/comments — commentaire invité (permission COMMENT).
// Passe par `CommentService.createGuest` : le retour d'un client déclenche la même chaîne
// qu'un retour interne (suiveurs, webhooks, journal v1, note ShotGrid), au lieu du seul
// `emit` socket qui se perdait dès que personne n'avait le projet ouvert.
router.post(
  '/:token/media/:id/comments',
  // Écriture ouverte à un anonyme : freinée par lien et par lien+IP (cf. clientShareLimits).
  ...guestCommentRateLimit,
  validate({ params: tokenAndId, body: guestCommentBody }),
  async (req, res) => {
    const share = await loadShareWithSession(String(req.params.token), req);
    const id = Number(req.params.id);
    const comment = await createShareComment(share, id, req.body as ShareCommentInput, req.ip);
    res.status(201).json({ comment });
  },
);

// POST /api/client/:token/media/:id/decision — avis de l'invité (permission DECIDE).
// Il n'écrase pas le statut de la version : le studio tranche (cf. `decideAsGuest`).
router.post(
  '/:token/media/:id/decision',
  // Même frein que le commentaire : c'est la même surface d'écriture anonyme.
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
